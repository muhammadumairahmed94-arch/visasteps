import type { User } from "@prisma/client";
import { db } from "./db";
import { ai } from "./adapters/ai";
import type { AiSource, ExtractedFact } from "./adapters/ai";
import { verifyAndAnnotateClaims, ensureFilePagesExtracted } from "./case-analysis";
import { decrypt } from "./crypto";
import { audit } from "./audit";
import { limit } from "./ratelimit";
import { NotFoundError, ForbiddenError } from "./errors";
import { visibleCases } from "./documents";
import { parseSingleUkDate } from "./number-check";
import { ukToday, isDateInWindow } from "./date-window";

const PURPOSE = "ai-question";

export type CheckVerdict = "OK" | "UNCLEAR" | "FAIL";

export interface DocumentCheck {
  name: string;
  verdict: CheckVerdict;
  detail: string;
  factQuote?: string;
}

export interface DocCheckResult {
  docId: string;
  title: string;
  folder: string;
  verdict: CheckVerdict;
  checks: DocumentCheck[];
}

function worstVerdict(checks: DocumentCheck[]): CheckVerdict {
  if (checks.length === 0) return "UNCLEAR";
  if (checks.some((c) => c.verdict === "FAIL")) return "FAIL";
  if (checks.some((c) => c.verdict === "UNCLEAR")) return "UNCLEAR";
  return "OK";
}

export function checkExpiry(value: string, quote: string, anchor: Date): DocumentCheck {
  const parsed = parseSingleUkDate(value);
  if (!parsed) {
    return { name: "Expiry date", verdict: "UNCLEAR", detail: "Could not read the expiry date.", factQuote: quote };
  }
  const expiryDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (expiryDate >= anchor) {
    return { name: "Expiry date", verdict: "OK", detail: `Expires ${value}, on or after submission date.`, factQuote: quote };
  }
  return { name: "Expiry date", verdict: "FAIL", detail: `Expires ${value}, before the submission date.`, factQuote: quote };
}

export function checkDateWindow(value: string, quote: string, window: string, anchor: Date): DocumentCheck {
  const parsed = parseSingleUkDate(value);
  if (!parsed) {
    return { name: "Document date", verdict: "UNCLEAR", detail: "Could not read the document date.", factQuote: quote };
  }
  const docDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const inWindow = isDateInWindow(docDate, window, anchor);
  if (inWindow === null) {
    return { name: "Document date", verdict: "UNCLEAR", detail: `Date window "${window}" is not recognised.`, factQuote: quote };
  }
  if (inWindow) {
    return { name: "Document date", verdict: "OK", detail: `Dated ${value}, within the required window.`, factQuote: quote };
  }
  return { name: "Document date", verdict: "FAIL", detail: `Dated ${value}, outside the required window.`, factQuote: quote };
}

export function checkName(
  value: string,
  quote: string,
  firstName: string | null,
  lastName: string | null,
): DocumentCheck {
  if (!firstName && !lastName) {
    return { name: "Name check", verdict: "UNCLEAR", detail: "Client name not set.", factQuote: quote };
  }
  const lv = value.toLowerCase();
  const firstOk = !firstName || lv.includes(firstName.toLowerCase());
  const lastOk = !lastName || lv.includes(lastName.toLowerCase());
  if (firstOk && lastOk) {
    return { name: "Name check", verdict: "OK", detail: `Name "${value}" matches client.`, factQuote: quote };
  }
  const expected = [firstName, lastName].filter(Boolean).join(" ");
  return {
    name: "Name check",
    verdict: "FAIL",
    detail: `Name "${value}" does not match client name "${expected}".`,
    factQuote: quote,
  };
}

function parseMoneyAmount(s: string): number | null {
  const n = parseFloat(s.replace(/[£€$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

export function checkAmount(value: string, quote: string, threshold: string): DocumentCheck {
  const docAmt = parseMoneyAmount(value);
  const threshAmt = parseMoneyAmount(threshold);
  if (docAmt === null || threshAmt === null) {
    return {
      name: "Amount check",
      verdict: "UNCLEAR",
      detail: `Could not compare "${value}" against threshold "${threshold}".`,
      factQuote: quote,
    };
  }
  if (docAmt >= threshAmt) {
    return { name: "Amount check", verdict: "OK", detail: `${value} meets the minimum of ${threshold}.`, factQuote: quote };
  }
  return {
    name: "Amount check",
    verdict: "FAIL",
    detail: `${value} is below the minimum of ${threshold}.`,
    factQuote: quote,
  };
}

function verifyFacts(rawFacts: ExtractedFact[], pageMap: Map<string, string>): ExtractedFact[] {
  if (rawFacts.length === 0) return [];
  const claims = rawFacts.map((f) => ({
    claimText: f.value,
    quote: f.quote,
    kind: "client-document" as const,
    fileId: f.fileId,
    pageNumber: f.pageNumber,
  }));
  const verified = verifyAndAnnotateClaims(claims, pageMap, new Map());
  const verifiedKeys = new Set(verified.map((v) => `${v.fileId}:${v.pageNumber}:${v.quote}`));
  return rawFacts.filter((f) => verifiedKeys.has(`${f.fileId}:${f.pageNumber}:${f.quote}`));
}

export async function checkDocuments(staff: User, clientId: string): Promise<DocCheckResult[]> {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });
  if (!firm.aiEnabled) throw new ForbiddenError("AI analysis is not enabled for this firm.");

  await limit("docCheck", staff.id);

  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    include: {
      documents: {
        include: {
          checklistItem: { select: { title: true, folder: true, dateWindow: true, typeKey: true } },
          files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
        },
      },
    },
  });
  if (!client) throw new NotFoundError("Not found.");

  const anchor = client.plannedSubmissionDate ?? ukToday();

  const moneyReqs = await db.requirement.findMany({
    where: { routeId: client.routeId, firmId: staff.firmId, ruleType: "MONEY_THRESHOLD", status: "APPROVED" },
    select: { evidenceNeeded: true, limitOrThreshold: true },
  });

  const results: DocCheckResult[] = [];

  for (const doc of client.documents) {
    if (doc.files.length === 0) continue;

    const { title, folder, dateWindow, typeKey } = doc.checklistItem;

    const sources: AiSource[] = [];
    const pageMap = new Map<string, string>();

    for (const file of doc.files) {
      await ensureFilePagesExtracted(file.id);
      const pages = await db.clientFilePage.findMany({
        where: { fileId: file.id },
        orderBy: { pageNumber: "asc" },
      });
      for (const p of pages) {
        const text = p.encryptedText ? decrypt(p.encryptedText, PURPOSE) : null;
        if (p.isImage || !text) continue;
        sources.push({
          label: `Client document: ${title}, page ${p.pageNumber}`,
          kind: "client-document",
          fileId: file.id,
          page: p.pageNumber,
          text,
        });
        pageMap.set(`${file.id}:${p.pageNumber}`, text);
      }
    }

    if (sources.length === 0) continue;

    const rawFacts = await ai().extractFacts({ sources });
    const verifiedFacts = verifyFacts(rawFacts, pageMap);

    const moneyThreshold =
      moneyReqs
        .filter(
          (r) =>
            r.limitOrThreshold &&
            (r.evidenceNeeded.toLowerCase().includes(title.toLowerCase()) ||
              r.evidenceNeeded.toLowerCase().includes(typeKey.toLowerCase())),
        )
        .map((r) => r.limitOrThreshold!)[0] ?? null;

    const checks: DocumentCheck[] = [];

    for (const fact of verifiedFacts) {
      if (fact.factKind === "expiry-date") {
        checks.push(checkExpiry(fact.value, fact.quote, anchor));
      } else if (fact.factKind === "document-date") {
        if (dateWindow) checks.push(checkDateWindow(fact.value, fact.quote, dateWindow, anchor));
      } else if (fact.factKind === "holder-name") {
        checks.push(checkName(fact.value, fact.quote, client.firstName ?? null, client.lastName ?? null));
      } else if (fact.factKind === "amount") {
        if (moneyThreshold) checks.push(checkAmount(fact.value, fact.quote, moneyThreshold));
      }
    }

    if (checks.length === 0) continue;

    results.push({ docId: doc.id, title, folder, verdict: worstVerdict(checks), checks });
  }

  await audit({ firmId: staff.firmId, actorType: "USER", actorId: staff.id, action: "case.doccheck", targetId: clientId });

  return results;
}
