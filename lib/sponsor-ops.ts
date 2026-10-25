/**
 * Stateful sponsor operations (DB access). Kept separate from lib/sponsor.ts
 * (which is pure) so pure tests never need a DB mock.
 */
import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { resolvedOwner } from "./sponsor";

/**
 * Reset any SPONSOR-assigned documents that are in REDO state back to NEED.
 * Called whenever the effective owner of such documents changes:
 *   - sponsor cancelled
 *   - caseworker overrides assignedToOverride
 *   - admin changes ChecklistItem.assignedTo route-wide
 */
export async function resetRedoForDocs(
  docIds: string[],
): Promise<void> {
  if (!docIds.length) return;
  await db.clientDocument.updateMany({
    where: { id: { in: docIds }, status: "REDO" },
    data: { status: "NEED", note: null, redoSince: null, redoRemindedAt: null },
  });
}

/**
 * Cancel a sponsor (set closedAt, revoke sessions and pending invites, reset any REDO docs).
 * Safe to call when no active sponsor exists — does nothing in that case.
 */
export async function cancelSponsor(
  parentClientId: string,
  actor: User | { firmId: string; id: string; role?: string } | null,
): Promise<void> {
  const sponsor = await db.client.findFirst({
    where: { sponsorForClientId: parentClientId, closedAt: null },
  });
  if (!sponsor) return;

  const now = new Date();
  await db.client.update({ where: { id: sponsor.id }, data: { closedAt: now } });
  await db.session.deleteMany({ where: { clientId: sponsor.id } });
  await db.invite.updateMany({ where: { clientId: sponsor.id, usedAt: null }, data: { usedAt: now } });

  // Find SPONSOR-assigned REDO documents on the parent case and reset them to NEED
  const redoDocs = await db.clientDocument.findMany({
    where: { clientId: parentClientId, status: "REDO" },
    include: { checklistItem: { select: { assignedTo: true } } },
  });
  // sponsorActive is now false; docs that were SPONSOR-assigned fall back to CLIENT
  // We reset REDO on any doc that is/was SPONSOR-assigned (override or route default)
  const toReset = redoDocs
    .filter((d) => {
      // Before cancel, sponsorActive was true — check what the owner would have been
      const owner = resolvedOwner({ assignedToOverride: d.assignedToOverride, checklistItem: d.checklistItem }, true);
      return owner === "SPONSOR";
    })
    .map((d) => d.id);
  await resetRedoForDocs(toReset);

  // Clear "can't find" flags on docs whose effective owner was SPONSOR before cancel
  const missingDocs = await db.clientDocument.findMany({
    where: { clientId: parentClientId, missingAt: { not: null } },
    include: { checklistItem: { select: { assignedTo: true } } },
  });
  const missingToReset = missingDocs
    .filter((d) => resolvedOwner({ assignedToOverride: d.assignedToOverride, checklistItem: d.checklistItem }, true) === "SPONSOR")
    .map((d) => d.id);
  if (missingToReset.length) {
    await db.clientDocument.updateMany({
      where: { id: { in: missingToReset } },
      data: { missingReason: null, missingAt: null, missingResponse: null },
    });
  }

  if (actor) {
    await audit({ firmId: actor.firmId, actorType: "USER", actorId: actor.id, action: "sponsor.cancel", targetId: parentClientId });
  }
}
