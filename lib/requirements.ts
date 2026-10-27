import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { limit } from "./ratelimit";
import { decrypt } from "./crypto";
import { UserError } from "./errors";
import { numbersMatch } from "./number-check";

const PURPOSE = "guidance-text";

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").replace(/­/g, "").toLowerCase();
}

/* ---------- generate draft run ---------- */

export async function generateRequirements(admin: User, routeId: string): Promise<string> {
  const route = await db.route.findFirst({ where: { id: routeId, firmId: admin.firmId } });
  if (!route) throw new UserError("Route not found.");

  await limit("requirementsDraft", admin.id);

  const links = await db.guidanceSourceOnRoute.findMany({
    where: { routeId },
    include: { source: { select: { id: true, status: true } } },
  });
  const activeSourceIds = links.filter((l) => l.source.status === "ACTIVE").map((l) => l.sourceId);
  if (activeSourceIds.length === 0) {
    throw new UserError("This route has no active guidance sources to draft from.");
  }

  const run = await db.draftRun.create({
    data: {
      firmId: admin.firmId,
      routeId,
      initiatedById: admin.id,
      sources: { create: activeSourceIds.map((sourceId) => ({ sourceId })) },
    },
  });

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "requirement.draft", targetId: run.id });
  return run.id;
}

/* ---------- retry a failed source ---------- */

export async function retryDraftSource(admin: User, runSourceId: string): Promise<void> {
  const runSource = await db.draftRunSource.findFirst({
    where: { id: runSourceId, run: { firmId: admin.firmId } },
  });
  if (!runSource) throw new UserError("Source not found.");
  if (runSource.status !== "FAILED" && runSource.status !== "NO_TEXT") {
    throw new UserError("Only failed or no-text sources can be retried.");
  }

  const run = await db.draftRun.findUnique({ where: { id: runSource.runId } });
  if (run?.status === "RUNNING") throw new UserError("This run is still in progress.");

  await db.$transaction([
    db.draftRunSource.update({ where: { id: runSourceId }, data: { status: "PENDING", errorMessage: null } }),
    db.draftRun.update({ where: { id: runSource.runId }, data: { status: "QUEUED", completedAt: null } }),
  ]);
}

/* ---------- edit a draft requirement ---------- */

const EditInput = z.object({
  whatIsChecked: z.string().trim().min(2).max(500).optional(),
  ruleType: z.enum(["DATE_LIMIT", "MONEY_THRESHOLD", "DOCUMENT_PRESENT", "NAME_MATCH", "OTHER"]).optional(),
  limitOrThreshold: z.string().max(200).nullable().optional(),
  evidenceNeeded: z.string().trim().min(2).max(2000).optional(),
  citationLocator: z.string().trim().min(1).max(300).optional(),
  citationQuote: z.string().trim().min(5).max(2000).optional(),
});

export async function editRequirement(admin: User, requirementId: string, rawEdits: unknown): Promise<void> {
  const v = EditInput.safeParse(rawEdits);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const edits = v.data;

  const req = await db.requirement.findFirst({
    where: { id: requirementId, firmId: admin.firmId, status: "DRAFT" },
  });
  if (!req) throw new UserError("Requirement not found or already reviewed.");

  const newLocator = edits.citationLocator ?? req.citationLocator;
  const newQuote = edits.citationQuote ?? req.citationQuote;

  if (edits.citationLocator !== undefined || edits.citationQuote !== undefined) {
    const page = await db.guidancePage.findUnique({
      where: { sourceId_locator: { sourceId: req.citationSourceId, locator: newLocator } },
    });
    if (!page) throw new UserError("The cited section does not exist.");
    const pageText = decrypt(page.encryptedText, PURPOSE);
    if (!normalise(pageText).includes(normalise(newQuote))) {
      throw new UserError("The quote was not found in the cited section. Check the citation and quote are correct.");
    }

    if (edits.citationQuote !== undefined) {
      const normQuote = normalise(newQuote);
      const wordCount = normQuote.split(/\s+/).filter(Boolean).length;
      if (wordCount < 8 || normQuote.length < 40) {
        throw new UserError("The quote must be at least 8 words and 40 characters long.");
      }
    }
  }

  if (edits.citationQuote !== undefined || edits.limitOrThreshold !== undefined) {
    const finalThreshold = edits.limitOrThreshold !== undefined ? edits.limitOrThreshold : req.limitOrThreshold;
    if (finalThreshold && !numbersMatch(finalThreshold, newQuote)) {
      throw new UserError("The number or amount stated in the limit must appear verbatim in the quote.");
    }
  }

  await db.requirement.update({
    where: { id: requirementId },
    data: {
      ...(edits.whatIsChecked !== undefined && { whatIsChecked: edits.whatIsChecked }),
      ...(edits.ruleType !== undefined && { ruleType: edits.ruleType }),
      ...(edits.limitOrThreshold !== undefined && { limitOrThreshold: edits.limitOrThreshold }),
      ...(edits.evidenceNeeded !== undefined && { evidenceNeeded: edits.evidenceNeeded }),
      ...(edits.citationLocator !== undefined && { citationLocator: edits.citationLocator }),
      ...(edits.citationQuote !== undefined && { citationQuote: newQuote }),
    },
  });

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "requirement.edit", targetId: requirementId });
}

/* ---------- approve or reject ---------- */

const ReviewInput = z.object({
  action: z.enum(["approve", "reject"]),
  whatIsChecked: z.string().trim().min(2).max(500).optional(),
  ruleType: z.enum(["DATE_LIMIT", "MONEY_THRESHOLD", "DOCUMENT_PRESENT", "NAME_MATCH", "OTHER"]).optional(),
  limitOrThreshold: z.string().max(200).nullable().optional(),
  evidenceNeeded: z.string().trim().min(2).max(2000).optional(),
});

export async function reviewRequirement(admin: User, requirementId: string, rawInput: unknown): Promise<void> {
  const v = ReviewInput.safeParse(rawInput);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const { action, ...edits } = v.data;

  const req = await db.requirement.findFirst({
    where: { id: requirementId, firmId: admin.firmId, status: "DRAFT" },
  });
  if (!req) throw new UserError("Requirement not found or already reviewed.");

  const finalRuleType = edits.ruleType ?? req.ruleType;

  await db.requirement.update({
    where: { id: requirementId },
    data: {
      status: action === "approve" ? "APPROVED" : "REJECTED",
      reviewedById: admin.id,
      reviewedAt: new Date(),
      ...(edits.whatIsChecked !== undefined && { whatIsChecked: edits.whatIsChecked }),
      ...(edits.ruleType !== undefined && { ruleType: edits.ruleType }),
      ...(edits.limitOrThreshold !== undefined && { limitOrThreshold: edits.limitOrThreshold }),
      ...(edits.evidenceNeeded !== undefined && { evidenceNeeded: edits.evidenceNeeded }),
    },
  });

  if (action === "approve" && finalRuleType === "DOCUMENT_PRESENT") {
    await db.checklistSuggestion.create({
      data: {
        firmId: admin.firmId,
        requirementId,
        documentName: (edits.whatIsChecked ?? req.whatIsChecked).trim(),
        description: (edits.evidenceNeeded ?? req.evidenceNeeded).trim(),
      },
    });
  }

  await audit({
    firmId: admin.firmId,
    actorType: "USER",
    actorId: admin.id,
    action: action === "approve" ? "requirement.approve" : "requirement.reject",
    targetId: requirementId,
  });
}

/* ---------- checklist suggestions ---------- */

const AcceptInput = z.object({
  folder: z.string().trim().min(1).max(200),
  groupLabel: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(200),
  why: z.string().trim().min(2).max(1000),
  typeKey: z.string().trim().min(1).max(100),
  required: z.boolean(),
  assignedTo: z.enum(["CLIENT", "SPONSOR"]),
});

export async function acceptChecklistSuggestion(admin: User, suggestionId: string, rawInput: unknown): Promise<void> {
  const v = AcceptInput.safeParse(rawInput);
  if (!v.success) throw new UserError(v.error.issues[0].message);
  const form = v.data;

  const suggestion = await db.checklistSuggestion.findFirst({
    where: { id: suggestionId, firmId: admin.firmId, status: "PENDING" },
    include: { requirement: { select: { routeId: true } } },
  });
  if (!suggestion) throw new UserError("Suggestion not found.");

  const routeId = suggestion.requirement.routeId;
  const maxOrder = await db.checklistItem.aggregate({ where: { routeId }, _max: { order: true } });

  await db.$transaction([
    db.checklistItem.create({
      data: {
        routeId,
        folder: form.folder,
        groupLabel: form.groupLabel,
        title: form.title,
        why: form.why,
        typeKey: form.typeKey,
        required: form.required,
        assignedTo: form.assignedTo,
        order: (maxOrder._max.order ?? 0) + 1,
      },
    }),
    db.checklistSuggestion.update({ where: { id: suggestionId }, data: { status: "ACCEPTED" } }),
  ]);

  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "requirement.suggestion.accept", targetId: suggestionId });
}

export async function ignoreChecklistSuggestion(admin: User, suggestionId: string): Promise<void> {
  const suggestion = await db.checklistSuggestion.findFirst({
    where: { id: suggestionId, firmId: admin.firmId, status: "PENDING" },
  });
  if (!suggestion) throw new UserError("Suggestion not found.");

  await db.checklistSuggestion.update({ where: { id: suggestionId }, data: { status: "IGNORED" } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "requirement.suggestion.ignore", targetId: suggestionId });
}

/* ---------- view ---------- */

export async function requirementsView(staff: User) {
  const isAdmin = staff.role === "ADMIN";

  const routes = await db.route.findMany({
    where: { firmId: staff.firmId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const requirements = await db.requirement.findMany({
    where: {
      firmId: staff.firmId,
      archivedAt: null,
      ...(isAdmin ? {} : { status: "APPROVED" }),
    },
    orderBy: { reviewedAt: "desc" },
    include: {
      citationSource: { select: { title: true, govukUrl: true } },
      reviewedBy: { select: { name: true } },
    },
  });

  const runs = isAdmin
    ? await db.draftRun.findMany({
        where: { firmId: staff.firmId },
        orderBy: { createdAt: "desc" },
        include: {
          sources: { include: { source: { select: { title: true } } } },
          initiatedBy: { select: { name: true } },
          rejectedDrafts: { orderBy: { id: "asc" } },
        },
        take: 5,
      })
    : [];

  const mentionedSources = isAdmin
    ? await db.mentionedSource.findMany({
        where: { firmId: staff.firmId },
        orderBy: { id: "desc" },
        include: { run: { select: { routeId: true, createdAt: true } } },
        take: 100,
      })
    : [];

  const suggestions = isAdmin
    ? await db.checklistSuggestion.findMany({
        where: { firmId: staff.firmId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        include: { requirement: { select: { routeId: true, whatIsChecked: true, evidenceNeeded: true } } },
      })
    : [];

  return {
    isAdmin,
    routes: routes.map((r) => {
      const routeReqs = requirements.filter((req) => req.routeId === r.id);
      const routeRuns = runs.filter((run) => run.routeId === r.id);
      const latestRun = routeRuns[0] ?? null;

      return {
        id: r.id,
        name: r.name,
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              createdAt: latestRun.createdAt.toISOString(),
              startedAt: latestRun.startedAt?.toISOString() ?? null,
              completedAt: latestRun.completedAt?.toISOString() ?? null,
              initiatedBy: latestRun.initiatedBy.name,
              sources: latestRun.sources.map((s) => ({
                id: s.id,
                title: s.source.title,
                status: s.status,
                requirementsFound: s.requirementsFound,
                errorMessage: s.errorMessage,
              })),
              rejectedDrafts: latestRun.rejectedDrafts.map((r) => ({
                id: r.id,
                whatIsChecked: r.whatIsChecked,
                citationLocator: r.citationLocator,
                reason: r.reason,
              })),
            }
          : null,
        draft: routeReqs
          .filter((r) => r.status === "DRAFT")
          .map(mapRequirement),
        approved: routeReqs
          .filter((r) => r.status === "APPROVED")
          .map(mapRequirement),
        rejected: isAdmin ? routeReqs.filter((r) => r.status === "REJECTED").map(mapRequirement) : [],
        mentionedSources: mentionedSources
          .filter((m) => m.run.routeId === r.id)
          .map((m) => ({ id: m.id, title: m.title, url: m.url, locator: m.locator })),
        suggestions: suggestions
          .filter((s) => s.requirement.routeId === r.id)
          .map((s) => ({
            id: s.id,
            documentName: s.documentName,
            description: s.description,
            requirementId: s.requirementId,
            whatIsChecked: s.requirement.whatIsChecked,
          })),
      };
    }),
  };
}

function mapRequirement(req: {
  id: string;
  whatIsChecked: string;
  ruleType: string;
  limitOrThreshold: string | null;
  evidenceNeeded: string;
  citationLocator: string;
  citationQuote: string;
  status: string;
  reviewedAt: Date | null;
  reviewedBy: { name: string } | null;
  citationSource: { title: string; govukUrl: string };
}) {
  return {
    id: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationLocator: req.citationLocator,
    citationQuote: req.citationQuote,
    status: req.status,
    reviewedAt: req.reviewedAt?.toISOString() ?? null,
    reviewedBy: req.reviewedBy?.name ?? null,
    citationSource: req.citationSource,
  };
}

export type RequirementsView = Awaited<ReturnType<typeof requirementsView>>;
export type RequirementsRouteView = RequirementsView["routes"][number];
