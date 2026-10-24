import type { User } from "@prisma/client";
import { db } from "./db";

export const TEXT: Record<string, string> = {
  // Client lifecycle
  "client.create": "Case created and invite sent",
  "client.invite": "Invite sent again",
  "client.invite.link": "Invite link made to send by WhatsApp/text",
  "client.reset.send": "Password reset link sent",
  "client.reset.link": "Password reset link made to send by WhatsApp/text",
  "client.account.create": "Client created their account",
  "client.reset.request": "Client asked for a password reset",
  "client.password.reset": "Client reset their password",
  "client.signin": "Client signed in",
  "client.signin.failed": "Wrong password entered",
  "client.signout": "Client signed out",
  "client.portal.view": "Client viewed the portal",
  "client.close": "Case closed",
  "client.reopen": "Case reopened",
  "client.delete": "Case permanently deleted",
  "client.reminder": "Reminder email sent: documents still needed",
  "client.reminder.redo": "Reminder email sent: please re-upload",
  "client.reminder.failed": "Reminder email could not be sent",
  // Client OTP
  "client.otp.request": "Sign-in code sent by email",
  "client.otp.verify": "Signed in with email code",
  "client.otp.failed": "Wrong sign-in code entered",
  // Staff auth
  "staff.signin": "Staff signed in",
  "staff.signin.failed": "Staff: wrong password entered",
  "staff.signout": "Staff signed out",
  "staff.password.set": "Staff set their password",
  "staff.2fa.failed": "Two-step sign-in: wrong code entered",
  "staff.2fa.enrol": "Two-step sign-in set up",
  "staff.2fa.recovery": "Two-step sign-in: recovery code used",
  // Staff case
  "staff.case.view": "Viewed the case",
  "staff.case.submissionDate": "Planned submission date set",
  "staff.case.stageChange.DOCUMENTS": "Changed case stage to Sending documents",
  "staff.case.stageChange.CHECKING": "Changed case stage to Lawyer checking",
  "staff.case.stageChange.READY": "Changed case stage to Ready to submit",
  "staff.case.stageChange.SUBMITTED": "Changed case stage to Submitted",
  "staff.case.stageChange.DECISION": "Changed case stage to Decision",
  // Documents
  "document.upload": "Uploaded",
  "document.approve": "Approved",
  "document.redo": "Asked to re-upload",
  "document.view": "Opened file",
  "document.virus": "Upload refused: virus scanner flagged the file",
  "document.missing": "Client said they cannot find this document",
  "document.missing.respond": "Caseworker replied about missing document",
  // Storage
  "storage.retry": "Retried saving to OneDrive",
  // Reminders
  "reminders.pause": "Reminders paused",
  "reminders.resume": "Reminders resumed",
  // Admin
  "admin.firm.update": "Firm settings saved",
  "admin.user.add": "Team member added",
  "admin.user.disable": "Team member removed",
  "admin.user.enable": "Team member restored",
  "admin.user.reset2fa": "Two-step sign-in reset",
  "admin.user.sendLink": "Password link sent",
  "admin.user.role": "Role changed",
  "admin.route.add": "Visa route added",
  "admin.item.add": "Checklist item added",
  "admin.item.edit": "Checklist item edited",
  "admin.item.remove": "Checklist item removed",
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
