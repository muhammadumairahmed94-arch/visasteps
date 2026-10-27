import { z } from "zod";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { visibleCases } from "@/lib/documents";
import { UserError } from "@/lib/errors";
import { limit } from "@/lib/ratelimit";
import type { GuidanceCheckItemResult } from "@/lib/guidance-check";
import type { GuidanceCheckVerdict } from "@/lib/guidance-check";
import { piiScrub } from "@/lib/eval-fixtures";
import type { EvalFixture, EvalFixtureLinkedItem, EvalFixturePage } from "@/lib/eval-fixtures";
import { randomUUID } from "node:crypto";

const RESULT_PURPOSE = "guidance-check";
const PAGE_PURPOSE = "ai-question";
const FIXTURE_PURPOSE = "eval-fixture";

const VERDICTS = ["MET", "NOT_MET", "UNCLEAR", "NOT_APPLICABLE"] as const;

const PreviewInput = z.object({
  action: z.literal("preview"),
  expectedVerdict: z.enum(VERDICTS),
});

const PageSchema = z.object({
  docId: z.string().min(1).max(64),
  title: z.string().min(1).max(256),
  uploaderKind: z.enum(["CLIENT", "SPONSOR"]),
  pageNumber: z.number().int().min(1),
  text: z.string().max(50_000),
});

const ConfirmInput = z.object({
  action: z.literal("confirm"),
  expectedVerdict: z.enum(VERDICTS),
  pages: z.array(PageSchema).min(1).max(200),
  confirmed: z.literal(true),
});

const Input = z.discriminatedUnion("action", [PreviewInput, ConfirmInput]);

// ─── shared: verify auth, access and DISAGREE requirement ─────────────────────

async function resolveItem(
  me: { id: string; firmId: string; role: string },
  clientId: string,
  runId: string,
  itemId: string,
) {
  const client = await db.client.findFirst({
    where: { id: clientId, ...visibleCases(me as Parameters<typeof visibleCases>[0]) },
    select: { id: true, firmId: true, route: { select: { name: true } } },
  });
  if (!client) return null;

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

  return item ? { client, item } : null;
}

// ─── handler ──────────────────────────────────────────────────────────────────

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string; runId: string; itemId: string }> }) => {
    const me = await currentStaff();
    if (!me) return fail("Signed out", 401);
    if (me.role !== "ADMIN") return fail("Admins only", 403);
    await limit("evalSaveTestCase", me.id);

    const { id: clientId, runId, itemId } = await ctx.params;

    const body = await req.json();
    const v = Input.safeParse(body);
    if (!v.success) throw new UserError(v.error.issues[0]!.message);
    const input = v.data;

    const resolved = await resolveItem(me, clientId, runId, itemId);
    if (!resolved) return fail("Not found", 404);
    const { client, item } = resolved;

    if (item.responses.length === 0) {
      throw new UserError("Can only save a test case after a caseworker has disagreed with this result.");
    }
    if (!item.requirementSnapshot) {
      throw new UserError("No requirement snapshot found — re-run the guidance check first.");
    }

    const reqSnap = JSON.parse(item.requirementSnapshot) as {
      whatIsChecked: string;
      ruleType: string;
      limitOrThreshold: string | null;
      evidenceNeeded: string;
      citationQuote: string;
    };

    // ── PREVIEW ───────────────────────────────────────────────────────────────
    if (input.action === "preview") {
      // Collect AI-extracted facts for PII detection
      let knownPii: Array<{ factKind: string; value: string }> = [];
      if (item.encryptedResult) {
        try {
          const result = JSON.parse(decrypt(item.encryptedResult, RESULT_PURPOSE)) as GuidanceCheckItemResult;
          knownPii = result.evidenceFound.map((e) => ({ factKind: e.factKind, value: e.value }));
        } catch {
          // non-fatal — fall back to regex-only scrubbing
        }
      }

      const requirement = await db.requirement.findUnique({
        where: { id: item.requirementId },
        select: { linkedChecklistItems: { select: { checklistItemId: true } } },
      });
      if (!requirement) throw new UserError("Requirement not found.");

      const linkedChecklistItemIds = requirement.linkedChecklistItems.map((l) => l.checklistItemId);

      const allClientIds = [clientId];
      const sponsors = await db.client.findMany({
        where: { sponsorForClientId: clientId, firmId: me.firmId },
        select: { id: true },
      });
      allClientIds.push(...sponsors.map((s) => s.id));

      const clientDocs = await db.clientDocument.findMany({
        where: { clientId: { in: allClientIds }, checklistItemId: { in: linkedChecklistItemIds } },
        include: {
          checklistItem: { select: { title: true } },
          files: {
            where: { storageStatus: "SAVED", supersededAt: null },
            include: { pages: { orderBy: { pageNumber: "asc" } } },
          },
        },
      });

      const linkedItemStatuses: EvalFixtureLinkedItem[] = [];
      const pages: EvalFixturePage[] = [];
      let docCounter = 0;
      const docIdMap = new Map<string, string>();

      for (const checklistItemId of linkedChecklistItemIds) {
        const doc = clientDocs.find((d) => d.checklistItemId === checklistItemId);
        const title = doc?.checklistItem.title ?? checklistItemId;
        const hasFile = (doc?.files ?? []).some((f) => f.pages.length > 0);
        const isRedo = doc?.status === "REDO";
        linkedItemStatuses.push({ checklistItemId, title, hasCurrentFile: hasFile, isRedo });

        if (!doc) continue;
        for (const file of doc.files) {
          if (file.pages.length === 0) continue;
          if (!docIdMap.has(doc.id)) docIdMap.set(doc.id, `doc-${++docCounter}`);
          const syntheticDocId = docIdMap.get(doc.id)!;
          const uploaderKind = file.uploaderKind === "SPONSOR" ? "SPONSOR" : "CLIENT";
          for (const page of file.pages) {
            if (page.isImage || !page.encryptedText) continue;
            const rawText = decrypt(page.encryptedText, PAGE_PURPOSE);
            const scrubbed = piiScrub(rawText, knownPii);
            pages.push({
              docId: syntheticDocId,
              title,
              uploaderKind: uploaderKind as "CLIENT" | "SPONSOR",
              pageNumber: page.pageNumber,
              text: scrubbed,
            });
          }
        }
      }

      if (pages.length === 0) {
        throw new UserError("No uploaded page text found for the linked documents.");
      }

      return json({
        ok: true,
        preview: {
          requirement: { id: item.requirementId, ...reqSnap },
          linkedItemStatuses,
          pages,
          expectedVerdict: input.expectedVerdict,
          caseworkerNote: item.responses[0]?.note ?? null,
          route: client.route.name,
        },
      });
    }

    // ── CONFIRM ───────────────────────────────────────────────────────────────
    // input.action === "confirm"
    const { expectedVerdict, pages } = input;

    const fixture: EvalFixture = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      route: client.route.name,
      requirement: { id: item.requirementId, ...reqSnap },
      linkedItemStatuses: pages
        .reduce<EvalFixtureLinkedItem[]>((acc, p) => {
          if (!acc.find((s) => s.checklistItemId === p.docId)) {
            acc.push({ checklistItemId: p.docId, title: p.title, hasCurrentFile: true, isRedo: false });
          }
          return acc;
        }, []),
      pages,
      expectedVerdict: expectedVerdict as GuidanceCheckVerdict,
      caseworkerNote: item.responses[0]?.note ?? null,
    };

    const encryptedData = encrypt(JSON.stringify(fixture), FIXTURE_PURPOSE);

    await db.evalFixture.create({
      data: {
        id: fixture.id,
        firmId: me.firmId,
        createdById: me.id,
        encryptedData,
      },
    });

    await audit({
      firmId: me.firmId,
      actorType: "USER",
      actorId: me.id,
      action: "case.guidancecheck.savetestcase",
      targetId: clientId,
    });

    return json({ ok: true, fixtureId: fixture.id });
  },
);
