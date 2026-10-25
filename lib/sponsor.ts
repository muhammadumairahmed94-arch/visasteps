/**
 * Pure helper functions for sponsor / partner accounts.
 * No DB access — all inputs come from the caller.
 */

type DocForOwner = {
  assignedToOverride: string | null;
  checklistItem: { assignedTo: string };
};

/**
 * Who is the effective owner of this document right now?
 * Falls back to "CLIENT" when the document is SPONSOR-assigned but no active sponsor exists,
 * so there is never a gap in the client's checklist.
 */
export function resolvedOwner(doc: DocForOwner, sponsorActive: boolean): "CLIENT" | "SPONSOR" {
  const effective = (doc.assignedToOverride ?? doc.checklistItem.assignedTo) as "CLIENT" | "SPONSOR";
  if (effective === "SPONSOR" && !sponsorActive) return "CLIENT";
  return effective;
}

type FileForVisibility = { supersededAt: Date | null; uploaderKind: string };

/**
 * Which active (non-superseded) files should this viewer see?
 * Generic so the full FileUpload shape is preserved in the return type.
 * When filesShared is true the caseworker has opened cross-party visibility.
 */
export function visibleFiles<T extends FileForVisibility>(
  files: T[],
  viewerKind: "CLIENT" | "SPONSOR",
  filesShared: boolean,
): T[] {
  const active = files.filter((f) => f.supersededAt === null);
  if (filesShared) return active;
  return active.filter((f) => f.uploaderKind === viewerKind);
}
