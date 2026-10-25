import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { visibleCases } from "@/lib/documents";
import { resolvedOwner } from "@/lib/sponsor";
import { resetRedoForDocs } from "@/lib/sponsor-ops";
import { audit } from "@/lib/audit";

/** PATCH: set per-case assignedToOverride for a document. */
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const docId = (await ctx.params).id;
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, client: visibleCases(me) },
    include: {
      client: { include: { sponsorAccounts: { where: { closedAt: null }, select: { id: true } } } },
      checklistItem: { select: { assignedTo: true } },
    },
  });
  if (!doc) return fail("Not found", 404);

  const { assignedTo } = await body<{ assignedTo: string }>(req);
  if (assignedTo !== "CLIENT" && assignedTo !== "SPONSOR") return fail("assignedTo must be CLIENT or SPONSOR.");

  const sponsorActive = doc.client.sponsorAccounts.length > 0;
  if (assignedTo === "SPONSOR" && !sponsorActive) return fail("This case has no active partner account.");

  const wasOwner = resolvedOwner(doc, sponsorActive);
  await db.clientDocument.update({ where: { id: docId }, data: { assignedToOverride: assignedTo } });
  const nowOwner = resolvedOwner({ ...doc, assignedToOverride: assignedTo }, sponsorActive);

  // REDO → NEED when effective owner changes
  if (wasOwner !== nowOwner && doc.status === "REDO") {
    await resetRedoForDocs([docId]);
  }

  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: `document.reassign.${assignedTo}`, targetId: docId });
  return json({ ok: true, assignedTo: nowOwner });
});
