import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { limit } from "./ratelimit";
import { encrypt, decrypt } from "./crypto";
import { ForbiddenError, NotFoundError } from "./errors";
import { visibleCases } from "./documents";
import { ukToday } from "./date-window";
import { checkOneDocument, collectPayslipEntries, buildPayslipSummary } from "./doc-checks";
import type { DocCheckResult } from "./doc-checks";
import {
  checkRequirement,
  buildGuidanceCheckResult,
} from "./guidance-check";
import type { GuidanceCheckItemResult, GuidanceCheckRunResult } from "./guidance-check";

const RESULT_PURPOSE = "guidance-check";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type { GuidanceCheckRunResult };

/**
 * Create a new GuidanceCheckRun for the given client and return its id.
 * Creates one GuidanceCheckItem per approved requirement on the client's route.
 */
export async function createGuidanceCheckRun(staff: User, clientId: string): Promise<string> {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: staff.firmId } });
  if (!firm.aiEnabled) throw new ForbiddenError("AI analysis is not enabled for this firm.");

  await limit("guidanceCheck", staff.id);

  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(staff) },
    select: { id: true, firmId: true, routeId: true },
  });
  if (!client) throw new NotFoundError("Not found.");

  const requirements = await db.requirement.findMany({
    where: { routeId: client.routeId, firmId: staff.firmId, status: "APPROVED", archivedAt: null },
    select: { id: true },
  });
  if (requirements.length === 0) throw new ForbiddenError("No approved requirements found for this route.");

  const run = await db.guidanceCheckRun.create({
    data: {
      clientId,
      firmId: staff.firmId,
      initiatedById: staff.id,
      items: { create: requirements.map((r) => ({ requirementId: r.id })) },
    },
  });

  await audit({
    firmId: staff.firmId,
    actorType: "USER",
    actorId: staff.id,
    action: "case.guidancecheck",
    targetId: clientId,
  });

  return run.id;
}

/**
 * Process pending GuidanceCheckRuns — called by the cron endpoint and jobs timer.
 * Handles one QUEUED/RUNNING run per call.
 */
export async function processGuidanceCheckRuns(): Promise<void> {
  // Recovery: reset items stuck in RUNNING
  await db.guidanceCheckItem.updateMany({ where: { status: "RUNNING" }, data: { status: "PENDING" } });
  // Reset runs stuck RUNNING with no pending items
  await db.guidanceCheckRun.updateMany({
    where: { status: "RUNNING", items: { none: { status: { in: ["PENDING", "RUNNING"] } } } },
    data: { status: "COMPLETE", completedAt: new Date() },
  });

  const run = await db.guidanceCheckRun.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "asc" },
    include: {
      client: {
        select: {
          routeId: true,
          firstName: true,
          lastName: true,
          plannedSubmissionDate: true,
          firmId: true,
          documents: {
            include: {
              files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
            },
          },
          sponsorAccounts: {
            select: {
              firstName: true,
              lastName: true,
              documents: {
                include: {
                  files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
                },
              },
            },
            take: 1,
          },
        },
      },
      items: { where: { status: { in: ["PENDING", "RUNNING"] } }, select: { id: true, requirementId: true } },
    },
  });
  if (!run) return;

  await db.guidanceCheckRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  const { client } = run;
  const anchor = client.plannedSubmissionDate ?? ukToday();
  const sponsor = client.sponsorAccounts[0] ?? null;

  // Collect all document ids (client + sponsor)
  const clientDocIds = client.documents.filter((d) => d.files.length > 0).map((d) => d.id);
  const sponsorDocIds = sponsor
    ? sponsor.documents.filter((d) => d.files.length > 0).map((d) => d.id)
    : [];
  const allDocIds = [...clientDocIds, ...sponsorDocIds];

  // Extract facts from every uploaded document
  const allDocs: DocCheckResult[] = [];
  for (const docId of allDocIds) {
    try {
      const result = await checkOneDocument(
        docId,
        client.firstName ?? null,
        client.lastName ?? null,
        sponsor?.firstName ?? null,
        sponsor?.lastName ?? null,
        anchor,
      );
      if (result) allDocs.push(result);
    } catch {
      // Swallow per-doc errors — requirement items will show UNCLEAR
    }
  }

  const payslipEntries = collectPayslipEntries(allDocs);
  const payslipSummary = buildPayslipSummary(payslipEntries);

  // Load requirement details for pending items
  const requirementIds = run.items.map((i) => i.requirementId);
  const requirements = await db.requirement.findMany({
    where: { id: { in: requirementIds } },
    select: {
      id: true,
      whatIsChecked: true,
      ruleType: true,
      limitOrThreshold: true,
      evidenceNeeded: true,
      citationQuote: true,
    },
  });

  const reqMap = new Map(requirements.map((r) => [r.id, r]));

  for (const item of run.items) {
    await db.guidanceCheckItem.update({ where: { id: item.id }, data: { status: "RUNNING" } });
    const req = reqMap.get(item.requirementId);
    if (!req) {
      await db.guidanceCheckItem.update({
        where: { id: item.id },
        data: { status: "FAILED", errorMessage: "Requirement not found." },
      });
      continue;
    }
    try {
      const result = checkRequirement(req, allDocs, payslipSummary, anchor);
      const encryptedResult = encrypt(JSON.stringify(result), RESULT_PURPOSE);
      await db.guidanceCheckItem.update({ where: { id: item.id }, data: { status: "DONE", encryptedResult } });
    } catch (e) {
      await db.guidanceCheckItem.update({
        where: { id: item.id },
        data: { status: "FAILED", errorMessage: errText(e) },
      });
    }
  }

  const remaining = await db.guidanceCheckItem.count({
    where: { runId: run.id, status: { in: ["PENDING", "RUNNING"] } },
  });
  const doneCount = await db.guidanceCheckItem.count({ where: { runId: run.id, status: "DONE" } });

  await db.guidanceCheckRun.update({
    where: { id: run.id },
    data: {
      status: remaining === 0 ? (doneCount === 0 ? "FAILED" : "COMPLETE") : "RUNNING",
      completedAt: remaining === 0 ? new Date() : null,
    },
  });
}

/** Get the current status of a run and its aggregated results (if complete). */
export async function getGuidanceCheckRun(
  staff: User,
  clientId: string,
  runId: string,
): Promise<{
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  result: GuidanceCheckRunResult | null;
} | null> {
  const run = await db.guidanceCheckRun.findFirst({
    where: { id: runId, clientId, firmId: staff.firmId },
    include: { items: true },
  });
  if (!run) return null;

  const total = run.items.length;
  const done = run.items.filter((i) => i.status === "DONE").length;
  const failed = run.items.filter((i) => i.status === "FAILED").length;

  let result: GuidanceCheckRunResult | null = null;
  if (run.status === "COMPLETE") {
    const itemResults: GuidanceCheckItemResult[] = run.items
      .filter((i) => i.status === "DONE" && i.encryptedResult)
      .map((i) => JSON.parse(decrypt(i.encryptedResult!, RESULT_PURPOSE)) as GuidanceCheckItemResult);

    // Fetch mentioned-but-not-uploaded sources for this client's route
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { routeId: true },
    });
    const mentionedSources = client
      ? await db.mentionedSource.findMany({
          where: { run: { routeId: client.routeId } },
          orderBy: { id: "desc" },
          take: 50,
          select: { title: true, url: true },
        })
      : [];

    result = buildGuidanceCheckResult(itemResults, mentionedSources);
  }

  return { id: run.id, status: run.status, total, done, failed, result };
}
