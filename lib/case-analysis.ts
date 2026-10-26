import type { User } from "@prisma/client";
import { db } from "./db";
import { storage } from "./adapters/storage";
import { ai } from "./adapters/ai";
import type { AiSource, AiCaseClaim, AiCaseResult } from "./adapters/ai";
import { encrypt, decrypt } from "./crypto";
import { audit } from "./audit";
import { limit } from "./ratelimit";
import { UserError, NotFoundError } from "./errors";
import { visibleCases } from "./documents";
import { numbersInQuote } from "./draft-runs";

const PURPOSE = "ai-question";
const IMAGE_TOKEN_ESTIMATE = 1700;
const TOKEN_LIMIT = 80_000;
const MIN_TEXT_CHARS = 30;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").replace(/­/g, "").toLowerCase();
}

async function extractPdfPages(buffer: Buffer): Promise<Array<{ pageNumber: number; text: string | null }>> {
  const { resolve } = await import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfjsLib: any;
  try {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjsLib = await import("pdfjs-dist");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")}`;

  const doc = await (pdfjsLib.getDocument({ data: new Uint8Array(buffer) }) as { promise: Promise<unknown> }).promise;
  const numPages = (doc as { numPages: number }).numPages;
  const results: Array<{ pageNumber: number; text: string | null }> = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(i);
    const content = await (page as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent();
    const text = content.items
      .map((item) => {
        const it = item as { str?: string; hasEOL?: boolean };
        return (it.str ?? "") + (it.hasEOL ? "\n" : "");
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    results.push({ pageNumber: i, text: text.length >= MIN_TEXT_CHARS ? text : null });
  }

  return results;
}

/** Extract and cache text pages for a file upload. Safe to call multiple times (upsert). */
export async function ensureFilePagesExtracted(fileId: string): Promise<void> {
  const existing = await db.clientFilePage.count({ where: { fileId } });
  if (existing > 0) return;

  const file = await db.fileUpload.findUnique({ where: { id: fileId } });
  if (!file?.oneDriveItemId || file.storageStatus !== "SAVED") return;

  const data = await storage().read(file.oneDriveItemId);
  const pages = await extractPdfPages(data);

  for (const { pageNumber, text } of pages) {
    await db.clientFilePage.upsert({
      where: { fileId_pageNumber: { fileId, pageNumber } },
      update: { encryptedText: text ? encrypt(text, PURPOSE) : null, isImage: text === null },
      create: { fileId, pageNumber, encryptedText: text ? encrypt(text, PURPOSE) : null, isImage: text === null },
    });
  }
}

/** Delete cached pages for a file (called when a file is superseded). */
export async function deleteFilePages(fileId: string): Promise<void> {
  await db.clientFilePage.deleteMany({ where: { fileId } });
}

type CaseFolder = { id: string; fileCount: number; pageCount: number; tokenEstimate: number };

type LoadedSources = {
  sources: AiSource[];
  folders: CaseFolder[];
  totalTokenEstimate: number;
  overLimit: boolean;
};

async function loadClientSources(staff: User, clientId: string, folderFilter?: string[]): Promise<LoadedSources> {
  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    include: {
      documents: {
        include: {
          checklistItem: { select: { title: true, folder: true } },
          files: {
            where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } },
          },
        },
      },
      sponsorAccounts: {
        include: {
          documents: {
            include: {
              checklistItem: { select: { title: true, folder: true } },
              files: {
                where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } },
              },
            },
          },
        },
      },
    },
  });
  if (!client) throw new NotFoundError("Not found.");

  type DocEntry = { title: string; folder: string; fileId: string; uploaderKind: string };
  const allDocs: DocEntry[] = [];

  for (const doc of client.documents) {
    const { title, folder } = doc.checklistItem;
    for (const file of doc.files) {
      allDocs.push({ title, folder, fileId: file.id, uploaderKind: file.uploaderKind });
    }
  }
  for (const sponsor of client.sponsorAccounts) {
    for (const doc of sponsor.documents) {
      const { title, folder } = doc.checklistItem;
      for (const file of doc.files) {
        allDocs.push({ title, folder, fileId: file.id, uploaderKind: "SPONSOR" });
      }
    }
  }

  const filtered = folderFilter && folderFilter.length > 0
    ? allDocs.filter((d) => folderFilter.includes(d.folder))
    : allDocs;

  const folderMap = new Map<string, CaseFolder>();
  const sources: AiSource[] = [];

  for (const doc of filtered) {
    await ensureFilePagesExtracted(doc.fileId);
    const pages = await db.clientFilePage.findMany({
      where: { fileId: doc.fileId },
      orderBy: { pageNumber: "asc" },
    });
    if (pages.length === 0) continue;

    const folderEntry = folderMap.get(doc.folder) ?? { id: doc.folder, fileCount: 0, pageCount: 0, tokenEstimate: 0 };
    folderEntry.fileCount++;
    folderMap.set(doc.folder, folderEntry);

    const prefix = doc.uploaderKind === "SPONSOR" ? "Partner" : "Client";
    for (const p of pages) {
      const text = p.encryptedText ? decrypt(p.encryptedText, PURPOSE) : null;
      const tokens = p.isImage ? IMAGE_TOKEN_ESTIMATE : Math.ceil((text?.length ?? 0) / 4);
      folderEntry.pageCount++;
      folderEntry.tokenEstimate += tokens;
      sources.push({
        label: `${prefix} document: ${doc.title}, page ${p.pageNumber}`,
        kind: "client-document",
        fileId: doc.fileId,
        page: p.pageNumber,
        text: p.isImage ? "[scanned image]" : (text ?? ""),
      });
    }
  }

  const folders = Array.from(folderMap.values());
  const totalTokenEstimate = folders.reduce((a, f) => a + f.tokenEstimate, 0);
  return { sources, folders, totalTokenEstimate, overLimit: totalTokenEstimate > TOKEN_LIMIT };
}

async function loadGuidanceSources(routeId: string): Promise<AiSource[]> {
  const links = await db.guidanceSourceOnRoute.findMany({
    where: { routeId },
    include: { source: { select: { id: true, title: true, status: true, pages: { orderBy: { locator: "asc" } } } } },
  });
  const sources: AiSource[] = [];
  for (const link of links) {
    if (link.source.status !== "ACTIVE") continue;
    for (const page of link.source.pages) {
      const text = decrypt(page.encryptedText, "guidance-text");
      sources.push({
        label: `Guidance: ${link.source.title} — ${page.locator}`,
        kind: "guidance",
        sourceId: link.source.id,
        locator: page.locator,
        text,
      });
    }
  }
  return sources;
}

export function verifyAndAnnotateClaims(
  claims: AiCaseClaim[],
  pageMap: Map<string, string>, // key: `${fileId}:${pageNumber}`, value: text
  guidanceMap: Map<string, string>, // key: `${sourceId}:${locator}`, value: text
): AiCaseClaim[] {
  const result: AiCaseClaim[] = [];
  for (const claim of claims) {
    let pageText: string | undefined;
    if (claim.kind === "client-document" && claim.fileId && claim.pageNumber !== undefined) {
      pageText = pageMap.get(`${claim.fileId}:${claim.pageNumber}`);
    } else if (claim.kind === "guidance" && claim.sourceId && claim.locator) {
      pageText = guidanceMap.get(`${claim.sourceId}:${claim.locator}`);
    }

    if (!pageText) {
      if (claim.kind === "guidance") {
        result.push({ ...claim, verified: false });
      }
      // client-doc claims with no page → drop
      continue;
    }

    const normPage = normalise(pageText);
    const normQuote = normalise(claim.quote);
    const wordCount = normQuote.split(/\s+/).filter(Boolean).length;

    const quoteFound = normPage.includes(normQuote);
    const longEnough = wordCount >= 8 && normQuote.length >= 40;
    const numbersOk = !numbersInQuote || numbersInQuote(claim.claimText, claim.quote);

    const verified = quoteFound && longEnough && numbersOk;

    if (claim.kind === "client-document") {
      if (verified) result.push({ ...claim, verified: true });
      // else: drop the claim silently
    } else {
      result.push({ ...claim, verified });
    }
  }
  return result;
}

export async function askCaseQuestion(
  staff: User,
  clientId: string,
  question: string,
  folderFilter?: string[],
): Promise<AiCaseResult> {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });
  if (!firm.aiEnabled) throw new UserError("AI analysis is not enabled for this firm.");

  await limit("aiAnalyse", staff.id);

  // Verify client is visible
  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    select: { id: true, routeId: true },
  });
  if (!client) throw new NotFoundError("Not found.");

  const { sources: clientSources, folders } = await loadClientSources(staff, clientId, folderFilter);
  const guidanceSources = await loadGuidanceSources(client.routeId);
  const allSources: AiSource[] = [...clientSources, ...guidanceSources];

  const raw = await ai().askCase({ sources: allSources, question });

  // Build lookup maps for verification
  const pageMap = new Map<string, string>();
  for (const s of clientSources) {
    if (s.fileId && s.page !== undefined && s.text !== "[scanned image]") {
      pageMap.set(`${s.fileId}:${s.page}`, s.text);
    }
  }
  const guidanceMap = new Map<string, string>();
  for (const s of guidanceSources) {
    if (s.sourceId && s.locator) {
      guidanceMap.set(`${s.sourceId}:${s.locator}`, s.text);
    }
  }

  const verifiedClaims = verifyAndAnnotateClaims(raw.claims, pageMap, guidanceMap);
  const result: AiCaseResult = { ...raw, claims: verifiedClaims };

  const foldersUsed = folders.map((f) => f.id);
  if (firm.analysisHistoryEnabled) {
    await db.aiQuestion.create({
      data: {
        clientId,
        firmId: staff.firmId,
        askedById: staff.id,
        encryptedQ: encrypt(question, PURPOSE),
        encryptedA: encrypt(JSON.stringify(result), PURPOSE),
        foldersUsed,
      },
    });
  }

  await audit({ firmId: staff.firmId, actorType: "USER", actorId: staff.id, action: "case.analyse", targetId: clientId });
  return result;
}

export async function deleteQuestion(staff: User, questionId: string): Promise<void> {
  const q = await db.aiQuestion.findFirst({
    where: { id: questionId, firmId: staff.firmId, client: visibleCases(staff) },
  });
  if (!q) throw new NotFoundError("Not found.");
  await db.aiQuestion.delete({ where: { id: questionId } });
  await audit({ firmId: staff.firmId, actorType: "USER", actorId: staff.id, action: "case.analysis.delete", targetId: questionId });
}

export async function getAnalysisView(staff: User, clientId: string) {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });

  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    select: { id: true, routeId: true },
  });
  if (!client) return null;

  const { folders, totalTokenEstimate, overLimit } = await loadClientSources(staff, clientId);

  const rawHistory = firm.analysisHistoryEnabled
    ? await db.aiQuestion.findMany({
        where: { clientId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { askedBy: { select: { name: true } } },
      })
    : [];

  const history = rawHistory.map((q) => {
    let parsed: AiCaseResult = { answer: "", claims: [], notFound: false };
    try { parsed = JSON.parse(decrypt(q.encryptedA, PURPOSE)) as AiCaseResult; } catch { /* keep default */ }
    return {
      id: q.id,
      createdAt: q.createdAt.toISOString(),
      askedBy: q.askedBy.name,
      question: decrypt(q.encryptedQ, PURPOSE),
      answer: parsed.answer,
      claims: parsed.claims,
      notFound: parsed.notFound,
      foldersUsed: q.foldersUsed,
    };
  });

  return {
    aiEnabled: firm.aiEnabled,
    historyEnabled: firm.analysisHistoryEnabled,
    folders,
    totalTokenEstimate,
    overLimit,
    history,
  };
}

export type AnalysisView = NonNullable<Awaited<ReturnType<typeof getAnalysisView>>>;
