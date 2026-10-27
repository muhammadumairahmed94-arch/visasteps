import { z } from "zod";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { visibleCases } from "@/lib/documents";
import { UserError } from "@/lib/errors";
import type { GuidanceCheckItemResult } from "@/lib/guidance-check";
import type { GuidanceCheckVerdict } from "@/lib/guidance-check";
import { piiScrub, writeEvalFixture, evalsDir } from "@/lib/eval-fixtures";
import type { EvalFixture, EvalFixtureLinkedItem, EvalFixturePage } from "@/lib/eval-fixtures";
import { randomUUID } from "node:crypto";

const RESULT_PURPOSE = "guidance-check";
const PAGE_PURPOSE = "ai-question";

const SaveInput = z.object({
  expectedVerdict: z.enum(["MET", "NOT_MET", "UNCLEAR", "NOT_APPLICABLE"]),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string; runId: string; itemId: string }> }) => {
    const me = await currentStaff();
    if (!me) return fail("Signed out", 401);

    // Admin-only action
    if (me.role !== "ADMIN") return fail("Admins only", 403);

    const { id: clientId, runId, itemId } = await ctx.params;

    // Verify staff has access to this client
    const client = await db.client.findFirst({
      where: { id: clientId, ...visibleCases(me) },
      select: { id: true, firmId: true, routeId: true, route: { select: { name: true } } },
    });
    if (!client) return fail("Not found", 404);

    // Verify item belongs to this run / firm and was disagreed with
    const item = await db.guidanceCheckItem.findFirst({
      where: { id: itemId, runId, run: { clientId, firmId: me.firmId } },
      select: {
        id: true,
        requirementId: true,
        requirementSnapshot: true,
        encryptedResult: true,
        responses: {
          where: { action: "DISAGREE" },
          select: { note: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!item) return fail("Item not found", 404);
    if (item.responses.length === 0) {
      throw new UserError("Can only save a test case after disagreeing with the result.");
    }

    const body = await req.json();
    const v = SaveInput.safeParse(body);
    if (!v.success) throw new UserError(v.error.issues[0].message);
    const { expectedVerdict } = v.data;

    // Read the requirement snapshot
    if (!item.requirementSnapshot) {
      throw new UserError("This item has no stored requirement snapshot — re-run the guidance check.");
    }
    const reqSnap = JSON.parse(item.requirementSnapshot) as {
      whatIsChecked: string;
      ruleType: string;
      limitOrThreshold: string | null;
      evidenceNeeded: string;
      citationQuote: string;
    };

    // Collect evidenceFound from the encrypted result (used for PII detection)
    let knownPii: Array<{ factKind: string; value: string }> = [];
    if (item.encryptedResult) {
      try {
        const result = JSON.parse(decrypt(item.encryptedResult, RESULT_PURPOSE)) as GuidanceCheckItemResult;
        knownPii = result.evidenceFound.map((e) => ({ factKind: e.factKind, value: e.value }));
      } catch {
        // non-fatal — fall back to regex-only scrubbing
      }
    }

    // Load the requirement's linked checklist items (current state)
    const requirement = await db.requirement.findUnique({
      where: { id: item.requirementId },
      select: {
        linkedChecklistItems: { select: { checklistItemId: true } },
      },
    });
    if (!requirement) throw new UserError("Requirement not found.");

    const linkedChecklistItemIds = requirement.linkedChecklistItems.map((l) => l.checklistItemId);

    // Find client + sponsor documents for these checklist items
    const allClientIds = [clientId];
    const sponsorAccounts = await db.client.findMany({
      where: { sponsorForClientId: clientId, firmId: me.firmId },
      select: { id: true },
    });
    allClientIds.push(...sponsorAccounts.map((s) => s.id));

    const clientDocs = await db.clientDocument.findMany({
      where: {
        clientId: { in: allClientIds },
        checklistItemId: { in: linkedChecklistItemIds },
      },
      include: {
        checklistItem: { select: { title: true, assignedTo: true } },
        files: {
          where: { storageStatus: "SAVED", supersededAt: null },
          include: {
            pages: { orderBy: { pageNumber: "asc" } },
          },
        },
      },
    });

    // Build linkedItemStatuses and pages
    const linkedItemStatuses: EvalFixtureLinkedItem[] = [];
    const pages: EvalFixturePage[] = [];

    // Counter for synthetic doc IDs
    let docCounter = 0;
    const docIdMap = new Map<string, string>(); // real ClientDocument.id → synthetic "doc-N"

    for (const checklistItemId of linkedChecklistItemIds) {
      const doc = clientDocs.find((d) => d.checklistItemId === checklistItemId);
      const title = doc?.checklistItem.title ?? checklistItemId;
      const hasFile = (doc?.files ?? []).some((f) => f.pages.length > 0);
      const isRedo = doc?.status === "REDO";

      linkedItemStatuses.push({
        checklistItemId,
        title,
        hasCurrentFile: hasFile,
        isRedo,
      });

      if (!doc) continue;

      for (const file of doc.files) {
        if (file.pages.length === 0) continue;
        if (!docIdMap.has(doc.id)) {
          docIdMap.set(doc.id, `doc-${++docCounter}`);
        }
        const syntheticDocId = docIdMap.get(doc.id)!;
        const uploaderKind = (file.uploaderKind === "SPONSOR" ? "SPONSOR" : "CLIENT") as "CLIENT" | "SPONSOR";

        for (const page of file.pages) {
          if (page.isImage || !page.encryptedText) continue;
          const rawText = decrypt(page.encryptedText, PAGE_PURPOSE);
          const scrubbed = piiScrub(rawText, knownPii);
          pages.push({
            docId: syntheticDocId,
            title,
            uploaderKind,
            pageNumber: page.pageNumber,
            text: scrubbed,
          });
        }
      }
    }

    if (pages.length === 0) {
      throw new UserError("No uploaded page text found for the linked documents — cannot save test case.");
    }

    // Build the fixture
    const caseworkerNote = item.responses[0]?.note ?? null;
    const fixture: EvalFixture = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      route: client.route.name,
      requirement: {
        id: item.requirementId,
        ...reqSnap,
      },
      linkedItemStatuses,
      pages,
      expectedVerdict: expectedVerdict as GuidanceCheckVerdict,
      caseworkerNote,
    };

    const filepath = writeEvalFixture(fixture, evalsDir());

    await audit({
      firmId: me.firmId,
      actorType: "USER",
      actorId: me.id,
      action: "case.guidancecheck.savetestcase",
      targetId: clientId,
    });

    return json({ ok: true, fixtureId: fixture.id, filepath });
  },
);
