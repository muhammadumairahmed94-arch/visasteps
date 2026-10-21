import { db } from "./db";
import { audit } from "./audit";
import { appUrl, createLink } from "./accounts";
import { sendSafely } from "./adapters/email";

/**
 * Automatic reminder emails (spec 4.5):
 *  - missing required documents: every 3 days, at most 5 per client
 *  - "Please redo": one reminder 2 days after the caseworker asked
 *  - only 9am–7pm UK time; caseworkers can pause per client
 * Safe to run from several servers: each reminder is claimed in the database before it is sent.
 */

const DAY = 86_400_000;
export const MISSING_EVERY_DAYS = 3;
export const MAX_MISSING = 5;
export const REDO_AFTER_DAYS = 2;

export function ukHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(d));
}
export const inSendingHours = (d = new Date()) => ukHour(d) >= 9 && ukHour(d) < 19;

/** Required, still-current checklist items the client has not sent. */
const missingWhere = { status: "NEED" as const, checklistItem: { required: true, archivedAt: null } };

export async function sendDueReminders(now = new Date()): Promise<{ missing: number; redo: number }> {
  if (!inSendingHours(now)) return { missing: 0, redo: 0 };
  const result = { missing: 0, redo: 0 };

  // 1. Missing documents
  const due = new Date(now.getTime() - MISSING_EVERY_DAYS * DAY);
  const clients = await db.client.findMany({
    where: {
      closedAt: null,
      remindersPaused: false,
      reminderCount: { lt: MAX_MISSING },
      documents: { some: missingWhere },
      OR: [{ lastReminderAt: { lte: due } }, { lastReminderAt: null, createdAt: { lte: due } }],
    },
    include: { firm: true, documents: { where: missingWhere, include: { checklistItem: true } } },
  });
  for (const c of clients) {
    const claimed = await db.client.updateMany({
      where: { id: c.id, reminderCount: c.reminderCount, lastReminderAt: c.lastReminderAt },
      data: { reminderCount: { increment: 1 }, lastReminderAt: now },
    });
    if (!claimed.count) continue; // another server got it
    let sent: boolean;
    if (!c.accountCreatedAt) {
      const link = await createLink(c.id, "SETUP");
      sent = await sendSafely({
        to: c.email,
        brand: c.firm.name,
        subject: `Reminder: ${c.firm.name} client portal invitation`,
        text: `${c.firm.name} is waiting for your visa documents.\n\nPlease create your account to start uploading. This new link is valid for 7 days.`,
        action: { label: "Create account", url: link },
      });
    } else {
      const titles = c.documents.map((d) => d.checklistItem.title);
      const list = titles.slice(0, 8).map((t) => `• ${t}`).join("\n") + (titles.length > 8 ? `\n• and ${titles.length - 8} more` : "");
      sent = await sendSafely({
        to: c.email,
        brand: c.firm.name,
        subject: `Reminder: documents still needed for your visa application`,
        text: `${c.firm.name} is still waiting for:\n\n${list}\n\nUnsure about a document? Upload it and our team will check it.`,
        action: { label: "Open client portal", url: `${appUrl()}/` },
      });
    }
    await audit({ firmId: c.firmId, actorType: "SYSTEM", action: sent ? "client.reminder" : "client.reminder.failed", targetId: c.id });
    if (sent) result.missing++;
  }

  // 2. "Please redo" — one reminder each, grouped per client
  const redoDue = new Date(now.getTime() - REDO_AFTER_DAYS * DAY);
  const redoDocs = await db.clientDocument.findMany({
    where: { status: "REDO", redoSince: { lte: redoDue }, redoRemindedAt: null, client: { closedAt: null, remindersPaused: false, accountCreatedAt: { not: null } } },
    include: { checklistItem: true, client: { include: { firm: true } } },
  });
  const byClient = new Map<string, typeof redoDocs>();
  for (const d of redoDocs) {
    const claimed = await db.clientDocument.updateMany({ where: { id: d.id, redoRemindedAt: null }, data: { redoRemindedAt: now } });
    if (claimed.count) byClient.set(d.clientId, [...(byClient.get(d.clientId) ?? []), d]);
  }
  for (const docs of byClient.values()) {
    const c = docs[0].client;
    const lines = docs.map((d) => `• ${d.checklistItem.title}${d.note ? ` — caseworker note: ${d.note}` : ""}`).join("\n");
    const sent = await sendSafely({
      to: c.email,
      brand: c.firm.name,
      subject: `Reminder: please re-upload ${docs.length === 1 ? docs[0].checklistItem.title : `${docs.length} documents`}`,
      text: `${c.firm.name} asked for these documents to be uploaded again:\n\n${lines}`,
      action: { label: "Open client portal", url: `${appUrl()}/` },
    });
    await audit({ firmId: c.firmId, actorType: "SYSTEM", action: sent ? "client.reminder.redo" : "client.reminder.failed", targetId: c.id });
    if (sent) result.redo++;
  }
  return result;
}

/** For the caseworker's Client tab. */
export function reminderSummary(c: { remindersPaused: boolean; reminderCount: number; lastReminderAt: Date | null; createdAt: Date }, missing: number) {
  if (c.remindersPaused) return { paused: true, text: "Reminders are paused for this client." };
  if (!missing) return { paused: false, text: "No reminders needed: nothing missing." };
  if (c.reminderCount >= MAX_MISSING) return { paused: false, text: `All ${MAX_MISSING} reminders have been sent.` };
  const next = new Date((c.lastReminderAt ?? c.createdAt).getTime() + MISSING_EVERY_DAYS * DAY);
  const when = next <= new Date() ? "within the next hour (9am–7pm UK time)" : next.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  return { paused: false, text: `${c.reminderCount} of ${MAX_MISSING} reminders sent. Next: ${when}.` };
}
