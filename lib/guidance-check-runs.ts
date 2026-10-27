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
import type {
  GuidanceCheckItemResult,
  GuidanceCheckRunResult,
  LinkedItemStatus,
  RequirementWithLinks,
} from "./guidance-check";

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
              checklistItem: { select: { title: true, assignedTo: true } },
              files: { where: { storageStatus: "SAVED", supersededAt: null, oneDriveItemId: { not: null } } },
            },
          },
          sponsorAccounts: {
            select: {
              firstName: true,
              lastName: true,
              documents: {
                include: {
                  checklistItem: { select: { title: true, assignedTo: true } },
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

  // Build docId → checklistItemId map and LinkedItemStatus map from live ClientDocument records
  type ClientDocRow = {
    id: string;
    checklistItemId: string;
    status: string;
    checklistItem: { title: string; assignedTo: string };
    files: { id: string }[];
  };
  const allClientDocRows: ClientDocRow[] = [
    ...client.documents,
    ...(sponsor?.documents ?? []),
  ] as ClientDocRow[];

  const docIdToChecklistItemId = new Map<string, string>();
  const linkedItemStatusByChecklistItemId = new Map<string, LinkedItemStatus>();

  for (const doc of allClientDocRows) {
    docIdToChecklistItemId.set(doc.id, doc.checklistItemId);
    linkedItemStatusByChecklistItemId.set(doc.checklistItemId, {
      checklistItemId: doc.checklistItemId,
      title: doc.checklistItem.title,
      hasCurrentFile: doc.files.length > 0,
      isRedo: doc.status === "REDO",
    });
  }

  // Extract facts from every uploaded document (client + sponsor)
  const clientDocIds = client.documents.filter((d) => (d as ClientDocRow).files.length > 0).map((d) => d.id);
  const sponsorDocIds = sponsor
    ? sponsor.documents.filter((d) => (d as ClientDocRow).files.length > 0).map((d) => d.id)
    : [];
  const allDocIds = [...clientDocIds, ...sponsorDocIds];

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

  // Group DocCheckResults by checklistItemId
  const docsByChecklistItemId = new Map<string, DocCheckResult[]>();
  for (const doc of allDocs) {
    const ciId = docIdToChecklistItemId.get(doc.docId);
    if (ciId) {
      const bucket = docsByChecklistItemId.get(ciId) ?? [];
      bucket.push(doc);
      docsByChecklistItemId.set(ciId, bucket);
    }
  }

  // Load requirement details including linked checklist items
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
      linkedChecklistItems: {
        select: { checklistItemId: true },
      },
    },
  });

  // Fetch active guidance sources for the route (for sourceVersionSnapshot)
  const routeSources = await db.guidanceSourceOnRoute.findMany({
    where: { routeId: client.routeId },
    include: { source: { select: { id: true, title: true, govukUrl: true } } },
  });
  const sourceVersionSnapshot = JSON.stringify(
    routeSources.map((rs) => ({ id: rs.source.id, title: rs.source.title, govukUrl: rs.source.govukUrl })),
  );

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
      // Build per-requirement filtered docs and linked item statuses
      const linkedItemIds = req.linkedChecklistItems.map((l) => l.checklistItemId);
      const linkedItemStatuses = linkedItemIds
        .map((id) => linkedItemStatusByChecklistItemId.get(id))
        .filter((s): s is LinkedItemStatus => s !== undefined);
      const filteredDocs = linkedItemIds.flatMap((id) => docsByChecklistItemId.get(id) ?? []);
      const filteredPayslipSummary = buildPayslipSummary(collectPayslipEntries(filteredDocs));

      const requirementWithLinks: RequirementWithLinks = {
        id: req.id,
        whatIsChecked: req.whatIsChecked,
        ruleType: req.ruleType,
        limitOrThreshold: req.limitOrThreshold,
        evidenceNeeded: req.evidenceNeeded,
        citationQuote: req.citationQuote,
        linkedItemStatuses,
        filteredDocs,
        filteredPayslipSummary,
      };

      const requirementSnapshot = JSON.stringify({
        whatIsChecked: req.whatIsChecked,
        ruleType: req.ruleType,
        limitOrThreshold: req.limitOrThreshold,
        evidenceNeeded: req.evidenceNeeded,
        citationQuote: req.citationQuote,
      });

      const result = checkRequirement(requirementWithLinks, anchor);
      const encryptedResult = encrypt(JSON.stringify(result), RESULT_PURPOSE);
      await db.guidanceCheckItem.update({
        where: { id: item.id },
        data: { status: "DONE", encryptedResult, requirementSnapshot },
      });
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
      ...(remaining === 0 ? { sourceVersionSnapshot } : {}),
    },
  });
}

export interface GuidanceCheckItemResponse {
  action: string;
  note: string | null;
  staffName: string;
  createdAt: string;
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
  itemResponses: Record<string, GuidanceCheckItemResponse[]>;
  itemIdByRequirementId: Record<string, string>;
} | null> {
  const run = await db.guidanceCheckRun.findFirst({
    where: { id: runId, clientId, firmId: staff.firmId },
    include: {
      items: {
        include: {
          responses: { include: { staff: { select: { name: true } } } },
        },
      },
    },
  });
  if (!run) return null;

  const total = run.items.length;
  const done = run.items.filter((i) => i.status === "DONE").length;
  const failed = run.items.filter((i) => i.status === "FAILED").length;

  // Build per-item response map keyed by requirementId
  const itemResponses: Record<string, GuidanceCheckItemResponse[]> = {};
  for (const item of run.items) {
    if (item.responses.length > 0) {
      itemResponses[item.requirementId] = item.responses.map((r) => ({
        action: r.action,
        note: r.note,
        staffName: r.staff.name,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  }

  // Also build a map from requirementId → itemId for the respond endpoint
  const itemIdByRequirementId: Record<string, string> = {};
  for (const item of run.items) {
    itemIdByRequirementId[item.requirementId] = item.id;
  }

  let result: GuidanceCheckRunResult | null = null;
  if (run.status === "COMPLETE") {
    const itemResults: GuidanceCheckItemResult[] = run.items
      .filter((i) => i.status === "DONE" && i.encryptedResult)
      .map((i) => JSON.parse(decrypt(i.encryptedResult!, RESULT_PURPOSE)) as GuidanceCheckItemResult);

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

  return { id: run.id, status: run.status, total, done, failed, result, itemResponses, itemIdByRequirementId };
}
