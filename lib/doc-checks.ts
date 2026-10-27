import { db } from "./db";
import { ai } from "./adapters/ai";
import type { AiSource, ExtractedFact } from "./adapters/ai";
import { verifyAndAnnotateClaims, ensureFilePagesExtracted } from "./case-analysis";
import { decrypt } from "./crypto";
import { parseSingleUkDate } from "./number-check";
import { isDateInWindow } from "./date-window";
import { compareNames, crossDocNameConsistency } from "./name-check";
import type { CrossDocNameEntry } from "./name-check";
import { validateMrzLine2 } from "./mrz";

const PURPOSE = "ai-question";

export type CheckVerdict = "OK" | "UNCLEAR" | "FAIL";

export interface DocumentCheck {
  name: string;
  verdict: CheckVerdict;
  detail: string;
  factQuote?: string;
}

/** A single verified fact extracted from a document, for display in the case summary. */
export interface SummaryFact {
  factKind: string;
  value: string;
  docTitle: string;
  uploaderKind: "CLIENT" | "SPONSOR";
  fileId: string;
  pageNumber: number;
  quote: string;
}

/** A single payslip amount entry. */
export interface PayslipEntry {
  amount: number;
  formattedAmount: string;
  payPeriod: "monthly" | "weekly" | "annual" | "unknown";
  payType: "gross" | "net" | "ytd" | "unknown";
  payDate: string | null;
  person: "CLIENT" | "SPONSOR";
  docTitle: string;
  quote: string;
}

/** Aggregated income data for one person (client or sponsor). */
export interface PersonPayslipSummary {
  grossEntries: PayslipEntry[];
  otherEntries: PayslipEntry[];
  payslipCount: number;
  dateRange: { earliest: string | null; latest: string | null };
  annualEstimate: number | null;
  estimateBasis: "monthly" | "weekly" | "unclear";
}

/** Aggregated payslip data split by person. */
export interface PayslipSummary {
  client: PersonPayslipSummary | null;
  sponsor: PersonPayslipSummary | null;
}

/** Cross-document name consistency result. */
export interface CrossDocNameCheck {
  person: "client" | "sponsor";
  expectedName: string;
  foundNames: { value: string; docTitle: string }[];
  verdict: CheckVerdict;
  detail: string;
}

export interface DocCheckResult {
  docId: string;
  title: string;
  folder: string;
  uploaderKind: "CLIENT" | "SPONSOR";
  verdict: CheckVerdict;
  checks: DocumentCheck[];
  summaryFacts: SummaryFact[];
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

/**
 * Check a holder name from a document against the expected person's name.
 * Uses whole-word matching; treats spelling variants and extra/missing middle names as UNCLEAR.
 */
export function checkName(
  value: string,
  quote: string,
  expectedFirst: string | null,
  expectedLast: string | null,
): DocumentCheck {
  const result = compareNames(value, expectedFirst, expectedLast);
  return { name: "Name check", verdict: result.verdict, detail: result.detail, factQuote: quote };
}

/** Validate MRZ check digits; return UNCLEAR if any fail. */
export function checkMrz(mrzValue: string, quote: string): DocumentCheck {
  const lines = mrzValue.split("\n");
  if (lines.length < 2) {
    return { name: "MRZ check digits", verdict: "UNCLEAR", detail: "Could not read the MRZ lines.", factQuote: quote };
  }
  const result = validateMrzLine2(lines[1]);
  if (result.checks.length === 0) {
    return { name: "MRZ check digits", verdict: "UNCLEAR", detail: "MRZ line 2 has wrong length — possible misread.", factQuote: quote };
  }
  const failed = result.checks.filter((c) => !c.valid);
  if (failed.length > 0) {
    const fields = failed.map((c) => c.field).join(", ");
    return { name: "MRZ check digits", verdict: "UNCLEAR", detail: `MRZ check digits failed for: ${fields}. Possible misread.`, factQuote: quote };
  }
  return { name: "MRZ check digits", verdict: "OK", detail: "All MRZ check digits valid.", factQuote: quote };
}

function parseMoneyAmount(s: string): number | null {
  const n = parseFloat(s.replace(/[£€$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

function detectPayPeriod(quote: string): "monthly" | "weekly" | "annual" | "unknown" {
  const q = quote.toLowerCase();
  if (/per\s+month|monthly|month\b/.test(q)) return "monthly";
  if (/per\s+week|weekly|week\b/.test(q)) return "weekly";
  if (/per\s+annum|annually|annual|per\s+year|yearly/.test(q)) return "annual";
  return "unknown";
}

function detectPayType(quote: string): "gross" | "net" | "ytd" | "unknown" {
  const q = quote.toLowerCase();
  if (/\b(?:year[\s-]to[\s-]date|ytd|cumulative|total\s+to\s+date)\b/.test(q)) return "ytd";
  if (/\b(?:gross\s+(?:pay|salary|income|wages)|basic\s+(?:pay|salary)|gross\b)/.test(q)) return "gross";
  if (/\b(?:net\s+(?:pay|salary)|take[\s-]home|after\s+tax)\b/.test(q)) return "net";
  return "unknown";
}

function extractFirstDateFromQuote(quote: string): string | null {
  const numMatch = quote.match(/\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/);
  if (numMatch) return numMatch[0];
  const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  const namedMatch = quote.match(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}\\b`, "i"));
  if (namedMatch) return namedMatch[0];
  return null;
}

function buildPersonPayslipSummary(entries: PayslipEntry[]): PersonPayslipSummary {
  const grossAll = entries.filter((e) => e.payType === "gross");
  const otherEntries = entries.filter((e) => e.payType !== "gross");

  // Deduplicate gross entries by payDate
  const seen = new Set<string>();
  const grossEntries: PayslipEntry[] = [];
  for (const e of grossAll) {
    const key = e.payDate ?? `_${e.docTitle}_${e.amount}`;
    if (!seen.has(key)) {
      seen.add(key);
      grossEntries.push(e);
    }
  }

  const payslipCount = grossEntries.length;
  const dates = grossEntries.map((e) => e.payDate).filter(Boolean) as string[];
  const dateRange = {
    earliest: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    latest: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null,
  };

  if (payslipCount === 0) {
    return { grossEntries, otherEntries, payslipCount, dateRange, annualEstimate: null, estimateBasis: "unclear" };
  }

  const monthly = grossEntries.filter((e) => e.payPeriod === "monthly");
  const weekly = grossEntries.filter((e) => e.payPeriod === "weekly");
  const mixedOrUnknown = grossEntries.filter((e) => e.payPeriod === "unknown" || e.payPeriod === "annual");

  let annualEstimate: number | null = null;
  let estimateBasis: "monthly" | "weekly" | "unclear" = "unclear";

  if (mixedOrUnknown.length === 0 && monthly.length > 0 && weekly.length === 0) {
    annualEstimate = Math.round((monthly.reduce((s, e) => s + e.amount, 0) / monthly.length) * 12);
    estimateBasis = "monthly";
  } else if (mixedOrUnknown.length === 0 && weekly.length > 0 && monthly.length === 0) {
    annualEstimate = Math.round((weekly.reduce((s, e) => s + e.amount, 0) / weekly.length) * 52);
    estimateBasis = "weekly";
  }

  return { grossEntries, otherEntries, payslipCount, dateRange, annualEstimate, estimateBasis };
}

export function buildPayslipSummary(entries: PayslipEntry[]): PayslipSummary {
  const clientEntries = entries.filter((e) => e.person === "CLIENT");
  const sponsorEntries = entries.filter((e) => e.person === "SPONSOR");
  return {
    client: clientEntries.length > 0 ? buildPersonPayslipSummary(clientEntries) : null,
    sponsor: sponsorEntries.length > 0 ? buildPersonPayslipSummary(sponsorEntries) : null,
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

/** Determine the dominant uploaderKind for a document (most files). */
function docUploaderKind(files: { uploaderKind: string }[]): "CLIENT" | "SPONSOR" {
  const sponsorCount = files.filter((f) => f.uploaderKind === "SPONSOR").length;
  return sponsorCount > files.length / 2 ? "SPONSOR" : "CLIENT";
}

function isPayslipDoc(title: string, typeKey: string): boolean {
  const t = (title + " " + typeKey).toLowerCase();
  return /payslip|pay\s*slip|salary\s*slip/.test(t);
}

export interface CheckDocumentsResult {
  docs: DocCheckResult[];
  payslipSummary: PayslipSummary;
  crossDocNameChecks: CrossDocNameCheck[];
}


/**
 * Run AI fact extraction + code-based checks on all saved documents for a client.
 * Called by the doc-check background job (one doc at a time).
 */
export async function checkOneDocument(
  docId: string,
  clientFirstName: string | null,
  clientLastName: string | null,
  sponsorFirstName: string | null,
  sponsorLastName: string | null,
  anchor: Date,
): Promise<DocCheckResult | null> {
  const doc = await db.clientDocument.findUnique({
    where: { id: docId },
    include: {
      checklistItem: { select: { title: true, folder: true, dateWindow: true } },
      files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
    },
  });
  if (!doc || doc.files.length === 0) return null;

  const { title, folder, dateWindow } = doc.checklistItem;
  const uploaderKind = docUploaderKind(doc.files);
  const expectedFirst = uploaderKind === "SPONSOR" ? sponsorFirstName : clientFirstName;
  const expectedLast = uploaderKind === "SPONSOR" ? sponsorLastName : clientLastName;
  const person = uploaderKind === "SPONSOR" ? "Partner" : "Client";

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
      const prefix = file.uploaderKind === "SPONSOR" ? "Partner" : "Client";
      sources.push({
        label: `${prefix} document: ${title}, page ${p.pageNumber}`,
        kind: "client-document",
        fileId: file.id,
        page: p.pageNumber,
        text,
      });
      pageMap.set(`${file.id}:${p.pageNumber}`, text);
    }
  }

  if (sources.length === 0) return null;

  const rawFacts = await ai().extractFacts({ sources });
  const verifiedFacts = verifyFacts(rawFacts, pageMap);

  const checks: DocumentCheck[] = [];
  const summaryFacts: SummaryFact[] = [];

  for (const fact of verifiedFacts) {
    const fileUploaderKind = (doc.files.find((f) => f.id === fact.fileId)?.uploaderKind ?? "CLIENT") as "CLIENT" | "SPONSOR";

    // Add to summary facts for display
    summaryFacts.push({
      factKind: fact.factKind,
      value: fact.value,
      docTitle: title,
      uploaderKind: fileUploaderKind,
      fileId: fact.fileId,
      pageNumber: fact.pageNumber,
      quote: fact.quote,
    });

    // Run appropriate check
    if (fact.factKind === "expiry-date") {
      checks.push(checkExpiry(fact.value, fact.quote, anchor));
    } else if (fact.factKind === "document-date") {
      if (dateWindow) checks.push(checkDateWindow(fact.value, fact.quote, dateWindow, anchor));
    } else if (fact.factKind === "holder-name") {
      checks.push(checkName(fact.value, fact.quote, expectedFirst, expectedLast));
      // The check name should reflect who the document belongs to
      const lastCheck = checks[checks.length - 1];
      lastCheck.name = `${person} name check`;
    } else if (fact.factKind === "mrz") {
      checks.push(checkMrz(fact.value, fact.quote));
    }
    // amount, date-of-birth, passport-number, address, relationship → summary only
  }

  if (checks.length === 0 && summaryFacts.length === 0) return null;

  return { docId: doc.id, title, folder, uploaderKind, verdict: worstVerdict(checks), checks, summaryFacts };
}

/** Build cross-document name checks from a set of DocCheckResults. */
export function buildCrossDocNameChecks(
  docs: DocCheckResult[],
  clientFirstName: string | null,
  clientLastName: string | null,
  sponsorFirstName: string | null,
  sponsorLastName: string | null,
): CrossDocNameCheck[] {
  const results: CrossDocNameCheck[] = [];

  for (const person of ["client", "sponsor"] as const) {
    const isClient = person === "client";
    const firstName = isClient ? clientFirstName : sponsorFirstName;
    const lastName = isClient ? clientLastName : sponsorLastName;
    if (!firstName && !lastName) continue;

    const expectedName = [firstName, lastName].filter(Boolean).join(" ");
    const targetUploaderKind = isClient ? "CLIENT" : "SPONSOR";

    // Collect all holder-name facts from docs belonging to this person
    const entries: CrossDocNameEntry[] = docs
      .filter((d) => d.uploaderKind === targetUploaderKind)
      .flatMap((d) =>
        d.summaryFacts
          .filter((f) => f.factKind === "holder-name")
          .map((f) => ({ value: f.value, docTitle: d.title })),
      );

    if (entries.length < 2) continue; // need at least 2 names to compare

    const consistency = crossDocNameConsistency(entries);
    results.push({
      person,
      expectedName,
      foundNames: entries,
      verdict: consistency.verdict,
      detail: consistency.detail,
    });
  }

  return results;
}

/** Collect payslip entries from all DocCheckResults. */
export function collectPayslipEntries(docs: DocCheckResult[]): PayslipEntry[] {
  const entries: PayslipEntry[] = [];
  for (const doc of docs) {
    const isPayslip = isPayslipDoc(doc.title, "");
    if (!isPayslip) continue;
    for (const fact of doc.summaryFacts) {
      if (fact.factKind !== "amount") continue;
      const amount = parseMoneyAmount(fact.value);
      if (amount === null || amount <= 0) continue;
      entries.push({
        amount,
        formattedAmount: fact.value,
        payPeriod: detectPayPeriod(fact.quote),
        payType: detectPayType(fact.quote),
        payDate: extractFirstDateFromQuote(fact.quote),
        person: doc.uploaderKind,
        docTitle: doc.title,
        quote: fact.quote,
      });
    }
  }
  return entries;
}
