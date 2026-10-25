import type { User } from "@prisma/client";
import { rm } from "node:fs/promises";
import { db } from "./db";
import { audit } from "./audit";
import { UserError } from "./errors";
import { deleteSessionChunks } from "./upload-sessions";
import { cancelSponsor } from "./sponsor-ops";

/** Same scoping as everywhere else: admins → whole firm, caseworkers → their own clients.
 *  sponsorForClientId: null prevents accidentally closing a sponsor row as if it were a case. */
const visible = (u: User) =>
  u.role === "ADMIN"
    ? { firmId: u.firmId, sponsorForClientId: null }
    : { firmId: u.firmId, caseworkerId: u.id, sponsorForClientId: null };

/**
 * Close (or reopen) a case. Closing signs the client out, stops their links and reminders, and keeps
 * every record and OneDrive file. Reopening lets them sign in again (send a fresh link if needed).
 */
export async function setCaseClosed(u: User, clientId: string, closed: boolean) {
  const client = await db.client.findFirst({ where: { id: clientId, ...visible(u) } });
  if (!client) throw new UserError("Not found.");
  await db.client.update({ where: { id: client.id }, data: { closedAt: closed ? new Date() : null } });
  if (closed) {
    // Auto-cancel any active sponsor account before closing the main case
    await cancelSponsor(client.id, u);
    await db.session.deleteMany({ where: { clientId: client.id } });
    await db.invite.updateMany({ where: { clientId: client.id, usedAt: null }, data: { usedAt: new Date() } });
    // Delete any in-progress upload session chunks (encrypted temp data)
    const uploadSessions = await db.uploadSession.findMany({ where: { clientId: client.id }, select: { id: true } });
    await Promise.all(uploadSessions.map((s) => deleteSessionChunks(s.id)));
    await db.uploadSession.deleteMany({ where: { clientId: client.id } });
  }
  await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: closed ? "client.close" : "client.reopen", targetId: client.id });
  return closed ? `${client.caseRef} closed. The client can no longer sign in.` : `${client.caseRef} reopened. Send the client a link if they need one.`;
}

/**
 * Permanently delete a client's portal record (admins only). OneDrive documents are NOT touched — they are the
 * firm's case file and fall under its retention policy. Refused while any file has not reached OneDrive yet.
 */
export async function deleteClient(u: User, clientId: string, confirm: string) {
  if (u.role !== "ADMIN") throw new UserError("Only admins can delete a client.");
  const client = await db.client.findFirst({
    where: { id: clientId, firmId: u.firmId, sponsorForClientId: null },
    include: { documents: { include: { files: { include: { jobs: true } } } } },
  });
  if (!client) throw new UserError("Not found.");
  if (confirm.trim().toUpperCase() !== client.caseRef.toUpperCase()) throw new UserError(`Type ${client.caseRef} to confirm.`);
  const files = client.documents.flatMap((d) => d.files);
  const unsaved = files.filter((f) => f.storageStatus !== "SAVED").length;
  if (unsaved) throw new UserError(`${unsaved} file${unsaved === 1 ? " has" : "s have"} not reached OneDrive yet. Retry ${unsaved === 1 ? "it" : "them"} first, so no document is lost.`);

  for (const job of files.flatMap((f) => f.jobs)) if (job.tempPath) await rm(job.tempPath, { force: true });
  // Delete upload session chunk folders before the DB cascade removes the session records
  const uploadSessions = await db.uploadSession.findMany({ where: { clientId: client.id }, select: { id: true } });
  await Promise.all(uploadSessions.map((s) => deleteSessionChunks(s.id)));
  await db.client.delete({ where: { id: client.id } }); // cascades: documents, file records, links, sessions, jobs
  // Kept in the audit log for accountability; no personal details beyond the case reference
  await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: "client.delete", targetId: client.caseRef });
  return `${client.caseRef} deleted from the portal. Its documents remain in OneDrive.`;
}
