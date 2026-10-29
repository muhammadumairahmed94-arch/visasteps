import { rm } from "node:fs/promises";
import type { User } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { UserError } from "./errors";
import { deleteSessionChunks } from "./upload-sessions";
import { cancelSponsor } from "./sponsor-ops";
import { storage } from "./adapters/storage";
import { sendSafely } from "./adapters/email";
import { appUrl } from "./accounts";

/** Returns the date a closed case is due for deletion, or null if the case is still open.
 *  retainUntil, if later than closedAt+retentionYears, overrides the standard calculation. */
export function retentionDueDate(closedAt: Date | null, retentionYears: number, retainUntil: Date | null = null): Date | null {
  if (!closedAt) return null;
  const d = new Date(closedAt);
  d.setFullYear(d.getFullYear() + retentionYears);
  if (retainUntil && retainUntil.getTime() > d.getTime()) return new Date(retainUntil);
  return d;
}

export type RetentionCase = {
  id: string;
  caseRef: string;
  name: string;
  closedAt: string;
  dueAt: string;
  daysUntilDue: number;
  legalHold: boolean;
  legalHoldReason: string | null;
  retainUntil: string | null;
  deletionPendingAt: string | null;
  deletionPendingTries: number;
};

/** All closed cases in the firm with their retention due dates. Open cases are excluded. */
export async function listRetentionCases(firmId: string): Promise<RetentionCase[]> {
  const firm = await db.firm.findUniqueOrThrow({ where: { id: firmId }, select: { retentionYears: true } });
  const clients = await db.client.findMany({
    where: { firmId, sponsorForClientId: null, closedAt: { not: null } },
    select: {
      id: true, caseRef: true, firstName: true, lastName: true, email: true,
      closedAt: true, legalHold: true, legalHoldReason: true,
      retainUntil: true, deletionPendingAt: true, deletionPendingTries: true,
    },
    orderBy: { closedAt: "asc" },
  });
  const now = Date.now();
  return clients
    .map((c) => {
      const dueAt = retentionDueDate(c.closedAt, firm.retentionYears, c.retainUntil)!;
      const daysUntilDue = Math.ceil((dueAt.getTime() - now) / 86_400_000);
      const name = c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.email;
      return {
        id: c.id,
        caseRef: c.caseRef,
        name,
        closedAt: c.closedAt!.toISOString().slice(0, 10),
        dueAt: dueAt.toISOString().slice(0, 10),
        daysUntilDue,
        legalHold: c.legalHold,
        legalHoldReason: c.legalHoldReason,
        retainUntil: c.retainUntil ? c.retainUntil.toISOString().slice(0, 10) : null,
        deletionPendingAt: c.deletionPendingAt ? c.deletionPendingAt.toISOString() : null,
        deletionPendingTries: c.deletionPendingTries,
      };
    })
    .filter((c) => c.daysUntilDue <= 30 || c.deletionPendingAt !== null);
}

/** Returns distinct case-level OneDrive folder paths from the client's FileUpload rows.
 *  Each entry is [topFolder, caseFolderName], e.g. ["Clients", "Khan_Ali_IM-2041"].
 *  Using FileUpload.folderPath rather than the client's current name handles renames correctly. */
async function caseFoldersFromUploads(clientId: string): Promise<string[][]> {
  const uploads = await db.fileUpload.findMany({
    where: { clientDocument: { clientId } },
    select: { folderPath: true },
  });
  const seen = new Set<string>();
  const folders: string[][] = [];
  for (const u of uploads) {
    if (!u.folderPath) continue;
    const segs = u.folderPath.split("/").filter(Boolean);
    if (segs.length < 2) continue;
    const key = `${segs[0]}/${segs[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push([segs[0], segs[1]]);
  }
  return folders;
}

/**
 * Permanently delete everything for a case: all DB records + OneDrive folder (including _Old versions).
 * OneDrive must succeed first; if it fails the case is marked deletion-pending (DB not touched).
 * Only callable by admins.
 */
export async function retentionDeleteCase(admin: User, clientId: string) {
  if (admin.role !== "ADMIN") throw new UserError("Only admins can delete cases.");

  const client = await db.client.findFirst({
    where: { id: clientId, firmId: admin.firmId, sponsorForClientId: null },
    include: { documents: { include: { files: { include: { jobs: true } } } } },
  });
  if (!client) throw new UserError("Not found.");
  if (!client.closedAt) throw new UserError("Only closed cases can be deleted under the retention policy.");
  if (client.legalHold) throw new UserError(`${client.caseRef} is on legal hold and cannot be deleted.`);

  // Clean up temp chunks and job files before attempting OneDrive deletion
  const uploadSessions = await db.uploadSession.findMany({ where: { clientId: client.id }, select: { id: true } });
  await Promise.all(uploadSessions.map((s) => deleteSessionChunks(s.id)));
  const files = client.documents.flatMap((d) => d.files);
  for (const job of files.flatMap((f) => f.jobs)) if (job.tempPath) await rm(job.tempPath, { force: true });
  await cancelSponsor(client.id, admin);

  // Find all distinct case-level OneDrive folders from actual FileUpload records
  const caseFolders = await caseFoldersFromUploads(client.id);

  try {
    for (const folder of caseFolders) await storage().deleteFolder(folder);
  } catch (e) {
    // OneDrive unreachable — mark pending so the daily job retries; do not delete DB records
    await db.client.update({
      where: { id: client.id },
      data: { deletionPendingAt: new Date(), deletionPendingTries: 1 },
    });
    console.error(`retention: OneDrive delete failed for ${client.caseRef}:`, e instanceof Error ? e.message : e);
    return `${client.caseRef}: OneDrive deletion failed. The case has been queued for automatic retry. It will not appear in the normal case list.`;
  }

  // OneDrive confirmed — now safe to remove DB records (cascade clears documents, files, sessions, etc.)
  await db.client.delete({ where: { id: client.id } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "retention.delete", targetId: client.caseRef });
  return `${client.caseRef} deleted under the retention policy. The audit record is kept.`;
}

/**
 * Extend a case's retention by pushing the due date forward.
 * Sets retainUntil = currentDueDate + extraYears. Records the reason in the audit log.
 */
export async function extendRetention(admin: User, clientId: string, extraYears: number, reason: string) {
  if (admin.role !== "ADMIN") throw new UserError("Only admins can extend retention.");
  if (!Number.isInteger(extraYears) || extraYears < 1 || extraYears > 10) throw new UserError("Enter 1–10 years.");
  if (!reason.trim()) throw new UserError("Enter a reason for the extension.");

  const firm = await db.firm.findUniqueOrThrow({ where: { id: admin.firmId }, select: { retentionYears: true } });
  const client = await db.client.findFirst({ where: { id: clientId, firmId: admin.firmId, sponsorForClientId: null } });
  if (!client) throw new UserError("Not found.");
  if (!client.closedAt) throw new UserError("Only closed cases can have their retention extended.");

  // Extend from the current effective due date (respecting any prior retainUntil)
  const currentDue = retentionDueDate(client.closedAt, firm.retentionYears, client.retainUntil)!;
  const newRetainUntil = new Date(currentDue);
  newRetainUntil.setFullYear(newRetainUntil.getFullYear() + extraYears);

  await db.client.update({ where: { id: client.id }, data: { retainUntil: newRetainUntil } });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: "retention.extend", targetId: client.caseRef });
  return `Retention for ${client.caseRef} extended by ${extraYears} year${extraYears === 1 ? "" : "s"}.`;
}

/** Set or clear a legal hold on a case (admin only). */
export async function setLegalHold(admin: User, clientId: string, hold: boolean, reason: string) {
  if (admin.role !== "ADMIN") throw new UserError("Only admins can set a legal hold.");
  if (hold && !reason.trim()) throw new UserError("Enter a reason for the legal hold.");

  const client = await db.client.findFirst({ where: { id: clientId, firmId: admin.firmId, sponsorForClientId: null } });
  if (!client) throw new UserError("Not found.");

  await db.client.update({
    where: { id: client.id },
    data: { legalHold: hold, legalHoldReason: hold ? reason.trim() : null, legalHoldAt: hold ? new Date() : null },
  });
  await audit({ firmId: admin.firmId, actorType: "USER", actorId: admin.id, action: hold ? "retention.hold.set" : "retention.hold.clear", targetId: client.id });
  return hold ? `Legal hold placed on ${client.caseRef}.` : `Legal hold removed from ${client.caseRef}.`;
}

/**
 * Daily job: retry pending OneDrive deletions; email admins about cases due within 30 days;
 * auto-delete cases that are past due (OneDrive first, then DB).
 */
export async function runRetentionJob() {
  const firms = await db.firm.findMany({ select: { id: true, name: true, retentionYears: true } });
  for (const firm of firms) {
    const clients = await db.client.findMany({
      where: { firmId: firm.id, sponsorForClientId: null, closedAt: { not: null }, legalHold: false },
      select: {
        id: true, caseRef: true, firstName: true, lastName: true, email: true,
        closedAt: true, retainUntil: true, deletionPendingAt: true, deletionPendingTries: true,
      },
    });
    const now = Date.now();
    const due: typeof clients = [];
    const pendingRetry: typeof clients = [];
    const warningSoon: typeof clients = [];

    for (const c of clients) {
      if (c.deletionPendingAt) { pendingRetry.push(c); continue; }
      const dueAt = retentionDueDate(c.closedAt, firm.retentionYears, c.retainUntil)!;
      const days = Math.ceil((dueAt.getTime() - now) / 86_400_000);
      if (days <= 0) due.push(c);
      else if (days <= 30) warningSoon.push(c);
    }

    if (due.length === 0 && warningSoon.length === 0 && pendingRetry.length === 0) continue;

    // Retry pending deletions (temp cleanup was done on first attempt)
    for (const c of pendingRetry) {
      try {
        const caseFolders = await caseFoldersFromUploads(c.id);
        for (const folder of caseFolders) await storage().deleteFolder(folder);
        await db.client.delete({ where: { id: c.id } });
        await audit({ firmId: firm.id, actorType: "SYSTEM", action: "retention.delete", targetId: c.caseRef });
        console.log(`retention: retry succeeded — deleted ${c.caseRef}`);
      } catch (e) {
        const tries = (c.deletionPendingTries ?? 0) + 1;
        await db.client.update({ where: { id: c.id }, data: { deletionPendingTries: tries } });
        console.error(`retention: retry ${tries} failed for ${c.caseRef}:`, e instanceof Error ? e.message : e);
        if (tries >= 3) {
          const adminEmails = await db.user.findMany({ where: { firmId: firm.id, role: "ADMIN", disabledAt: null }, select: { email: true } });
          const url = `${appUrl()}/staff`;
          for (const a of adminEmails) {
            await sendSafely({
              to: a.email, brand: firm.name,
              subject: `OneDrive deletion failed — ${c.caseRef} (${tries} attempts)`,
              text: `Deletion of case ${c.caseRef} from OneDrive has failed ${tries} times.\n\nThe case data is kept in the database until OneDrive deletion succeeds. Please check your OneDrive connection, then use Admin → Deletion to retry.`,
              action: { label: "Go to Admin", url },
            }).catch((err) => console.error("retention pending alert:", err instanceof Error ? err.message : err));
          }
        }
      }
    }

    // Auto-delete cases that are past due for the first time
    for (const c of due) {
      try {
        const caseFolders = await caseFoldersFromUploads(c.id);
        for (const folder of caseFolders) await storage().deleteFolder(folder);
        // OneDrive confirmed — clean up sessions and delete DB records
        const uploadSessions = await db.uploadSession.findMany({ where: { clientId: c.id }, select: { id: true } });
        await Promise.all(uploadSessions.map((s) => deleteSessionChunks(s.id)));
        await db.client.delete({ where: { id: c.id } });
        await audit({ firmId: firm.id, actorType: "SYSTEM", action: "retention.delete", targetId: c.caseRef });
        console.log(`retention: deleted ${c.caseRef}`);
      } catch (e) {
        // Mark pending; DB not deleted
        await db.client.update({ where: { id: c.id }, data: { deletionPendingAt: new Date(), deletionPendingTries: 1 } });
        console.error(`retention: first attempt failed for ${c.caseRef}:`, e instanceof Error ? e.message : e);
      }
    }

    // Email all admins about the daily summary
    const admins = await db.user.findMany({ where: { firmId: firm.id, role: "ADMIN", disabledAt: null }, select: { email: true } });
    if (admins.length === 0) continue;
    const lines: string[] = [];
    if (due.length > 0) {
      lines.push(`${due.length} case${due.length === 1 ? " is" : "s are"} due for deletion now:`);
      for (const c of due) lines.push(`  • ${c.caseRef} — closed ${c.closedAt!.toISOString().slice(0, 10)}`);
    }
    if (pendingRetry.length > 0) {
      lines.push(`${pendingRetry.length} case${pendingRetry.length === 1 ? " has" : "s have"} a deletion pending (OneDrive unreachable):`);
      for (const c of pendingRetry) lines.push(`  • ${c.caseRef} (${c.deletionPendingTries} attempt${c.deletionPendingTries === 1 ? "" : "s"})`);
    }
    if (warningSoon.length > 0) {
      lines.push(`${warningSoon.length} case${warningSoon.length === 1 ? " is" : "s are"} due within 30 days:`);
      for (const c of warningSoon) {
        const dueAt = retentionDueDate(c.closedAt, firm.retentionYears, c.retainUntil)!;
        lines.push(`  • ${c.caseRef} — due ${dueAt.toISOString().slice(0, 10)}`);
      }
    }
    const url = `${appUrl()}/staff`;
    for (const a of admins) {
      await sendSafely({
        to: a.email, brand: firm.name,
        subject: "Cases due for deletion — action required",
        text: lines.join("\n") + "\n\nReview the Due for deletion list in Admin → Deletion and delete or extend each case.",
        action: { label: "Go to Admin", url },
      }).catch((e) => console.error("retention warning email:", e instanceof Error ? e.message : e));
    }
  }
}
