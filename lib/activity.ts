import type { User } from "@prisma/client";
import { db } from "./db";

const TEXT: Record<string, string> = {
  "client.create": "Case created and invite sent",
  "client.invite": "Invite sent again",
  "client.reset.send": "Password reset link sent",
  "client.invite.link": "Invite link made to send by WhatsApp/text",
  "client.reset.link": "Password reset link made to send by WhatsApp/text",
  "client.account.create": "Client created their account",
  "client.reset.request": "Client asked for a password reset",
  "client.password.reset": "Client reset their password",
  "client.signin": "Client signed in",
  "client.signin.failed": "Wrong password entered",
  "client.signout": "Client signed out",
  "client.portal.view": "Client viewed the portal",
  "document.upload": "Uploaded",
  "document.approve": "Approved",
  "document.redo": "Asked to re-upload",
  "document.view": "Opened file",
  "document.virus": "Upload refused: virus scanner flagged the file",
  "staff.case.view": "Viewed the case",
  "client.close": "Case closed",
  "client.reopen": "Case reopened",
  "storage.retry": "Retried saving to OneDrive",
  "client.reminder": "Reminder email sent: documents still needed",
  "client.reminder.redo": "Reminder email sent: please re-upload",
  "client.reminder.failed": "Reminder email could not be sent",
  "reminders.pause": "Reminders paused",
  "reminders.resume": "Reminders resumed",
};

/** Recent audit entries for one client, in plain words, newest first. Scoped to the caller's firm. */
export async function clientActivity(u: User, clientId: string, take = 40) {
  const client = await db.client.findFirst({
    where: { id: clientId, firmId: u.firmId, ...(u.role === "ADMIN" ? {} : { caseworkerId: u.id }) },
    include: { documents: { include: { checklistItem: true, files: true } } },
  });
  if (!client) return null;

  // Map every id that can appear as a target back to a document title
  const title = new Map<string, string>();
  for (const d of client.documents) {
    title.set(d.id, d.checklistItem.title);
    for (const f of d.files) title.set(f.id, d.checklistItem.title);
  }
  const rows = await db.auditLog.findMany({
    where: { firmId: u.firmId, OR: [{ actorId: client.id }, { targetId: { in: [client.id, ...title.keys()] } }] },
    orderBy: { at: "desc" },
    take,
  });
  const staff = new Map((await db.user.findMany({ where: { firmId: u.firmId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    who: r.actorType === "CLIENT" ? "Client" : r.actorType === "SYSTEM" ? "Portal" : (staff.get(r.actorId ?? "") ?? "Staff"),
    what: [TEXT[r.action] ?? r.action, r.targetId ? title.get(r.targetId) : undefined].filter(Boolean).join(": "),
  }));
}
