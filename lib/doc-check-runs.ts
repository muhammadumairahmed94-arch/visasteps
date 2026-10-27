import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { limit } from "./ratelimit";
import { encrypt, decrypt } from "./crypto";
import { ForbiddenError, NotFoundError } from "./errors";
import { visibleCases } from "./documents";
import { ukToday } from "./date-window";
import { checkOneDocument, buildCrossDocNameChecks, collectPayslipEntries, buildPayslipSummary } from "./doc-checks";
import type { DocCheckResult, CheckDocumentsResult } from "./doc-checks";

const RESULT_PURPOSE = "ai-question";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Re-export so callers don't need to import both files
export type { CheckDocumentsResult };

/**
 * Create a new DocCheckRun for the given client and return its id.
 * Creates one DocCheckItem per document that has saved files.
 */
export async function createDocCheckRun(staff: User, clientId: string): Promise<string> {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });
  if (!firm.aiEnabled) throw new ForbiddenError("AI analysis is not enabled for this firm.");

  await limit("docCheck", staff.id);

  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    include: {
      documents: {
        include: {
          files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
        },
      },
    },
  });
  if (!client) throw new NotFoundError("Not found.");

  const docsWithFiles = client.documents.filter((d) => d.files.length > 0);
  if (docsWithFiles.length === 0) throw new ForbiddenError("No saved documents to check.");

  const run = await db.docCheckRun.create({
    data: {
      clientId,
      firmId: staff.firmId,
      initiatedById: staff.id,
      items: { create: docsWithFiles.map((d) => ({ docId: d.id })) },
    },
  });

  await audit({ firmId: staff.firmId, actorType: "USER", actorId: staff.id, action: "case.doccheck", targetId: clientId });

  return run.id;
}

/**
 * Process pending DocCheckRuns — called by the cron endpoint.
 * Handles one QUEUED/RUNNING run per call, processes its items one by one.
 */
export async function processDocCheckRuns(): Promise<void> {
  // Recovery: reset items stuck in RUNNING
  await db.docCheckItem.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING" } });
  // Reset runs stuck RUNNING with no pending items
  await db.docCheckRun.updateMany({
    where: { status: "RUNNING", items: { none: { status: { in: ["PENDING", "RUNNING"] } } } },
    data: { status: "COMPLETE", completedAt: new Date() },
  });

  const run = await db.docCheckRun.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    include: {
      client: {
        select: {
          firstName: true, lastName: true, plannedSubmissionDate: true,
          sponsorAccounts: { select: { firstName: true, lastName: true }, take: 1 },
        },
      },
      items: {
        where: { status: { in: ["PENDING", "RUNNING"] } },
      },
    },
  });
  if (!run) return;

  await db.docCheckRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  const { client } = run;
  const anchor = client.plannedSubmissionDate ?? ukToday();
  const sponsor = client.sponsorAccounts[0] ?? null;

  for (const item of run.items) {
    await db.docCheckItem.update({ where: { id: item.id }, data: { status: "RUNNING" } });
    try {
      const result = await checkOneDocument(
        item.docId,
        client.firstName ?? null,
        client.lastName ?? null,
        sponsor?.firstName ?? null,
        sponsor?.lastName ?? null,
        anchor,
      );
      if (!result) {
        await db.docCheckItem.update({ where: { id: item.id }, data: { status: "NO_TEXT" } });
      } else {
        const encryptedResult = encrypt(JSON.stringify(result), RESULT_PURPOSE);
        await db.docCheckItem.update({ where: { id: item.id }, data: { status: "DONE", encryptedResult } });
      }
    } catch (e) {
      await db.docCheckItem.update({
        where: { id: item.id },
        data: { status: "FAILED", errorMessage: errText(e) },
      });
    }
  }

  const remaining = await db.docCheckItem.count({ where: { runId: run.id, status: { in: ["PENDING", "RUNNING"] } } });
  const doneCount = await db.docCheckItem.count({ where: { runId: run.id, status: "DONE" } });

  await db.docCheckRun.update({
    where: { id: run.id },
    data: {
      status: remaining === 0 ? (doneCount === 0 ? "FAILED" : "COMPLETE") : "RUNNING",
      completedAt: remaining === 0 ? new Date() : null,
    },
  });
}

/** Get the current status of a run and its aggregated results (if complete). */
export async function getDocCheckRun(
  staff: User,
  clientId: string,
  runId: string,
): Promise<{
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  result: CheckDocumentsResult | null;
} | null> {
  const run = await db.docCheckRun.findFirst({
    where: { id: runId, clientId, firmId: staff.firmId },
    include: { items: true },
  });
  if (!run) return null;

  const total = run.items.length;
  const done = run.items.filter((i) => i.status === "DONE").length;
  const failed = run.items.filter((i) => i.status === "FAILED").length;

  // Aggregate results from DONE items
  const docs: DocCheckResult[] = run.items
    .filter((i) => i.status === "DONE" && i.encryptedResult)
    .map((i) => JSON.parse(decrypt(i.encryptedResult!, RESULT_PURPOSE)) as DocCheckResult);

  // Get client/sponsor names for cross-doc checks
  let result: CheckDocumentsResult | null = null;
  if (docs.length > 0) {
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: {
        firstName: true, lastName: true,
        sponsorAccounts: { select: { firstName: true, lastName: true }, take: 1 },
      },
    });
    const sponsor = client?.sponsorAccounts[0] ?? null;
    const crossDocNameChecks = buildCrossDocNameChecks(
      docs,
      client?.firstName ?? null,
      client?.lastName ?? null,
      sponsor?.firstName ?? null,
      sponsor?.lastName ?? null,
    );
    const payslipEntries = collectPayslipEntries(docs);
    result = { docs, payslipSummary: buildPayslipSummary(payslipEntries), crossDocNameChecks };
  }

  return { id: run.id, status: run.status, total, done, failed, result };
}

// Re-export buildPayslipSummary so callers can use it
export { buildPayslipSummary } from "./doc-checks";
