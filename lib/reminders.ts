import { db } from "./db";
import { audit } from "./audit";
import { appUrl, createLink } from "./accounts";
import { sendSafely } from "./adapters/email";
import { resolvedOwner } from "./sponsor";

/**
 * Automatic reminder emails (spec 4.5):
 *  - missing required documents: every 3 days, at most 5 per client/sponsor
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

/** Required, still-current items not yet sent and not flagged by the client as "I don't have this". */
const missingWhere = { status: "NEED" as const, missingAt: null, checklistItem: { required: true, archivedAt: null } };

export async function sendDueReminders(now = new Date()): Promise<{ missing: number; redo: number }> {
  if (!inSendingHours(now)) return { missing: 0, redo: 0 };
  const result = { missing: 0, redo: 0 };

  // 1. Missing documents — main clients
  const due = new Date(now.getTime() - MISSING_EVERY_DAYS * DAY);
  const clients = await db.client.findMany({
    where: {
      sponsorForClientId: null, // main cases only — sponsor rows are handled separately below
      closedAt: null,
      remindersPaused: false,
      reminderCount: { lt: MAX_MISSING },
      documents: { some: missingWhere },
      OR: [{ lastReminderAt: { lte: due } }, { lastReminderAt: null, createdAt: { lte: due } }],
    },
    include: {
      firm: true,
      documents: { where: missingWhere, include: { checklistItem: true } },
      sponsorAccounts: { where: { closedAt: null }, select: { id: true } },
    },
  });
  for (const c of clients) {
    const sponsorActive = c.sponsorAccounts.length > 0;
    // Only include CLIENT-assigned NEED docs in the client reminder
    const clientDocs = c.documents.filter((d) => resolvedOwner(d, sponsorActive) === "CLIENT");
    if (!clientDocs.length) continue; // all NEED docs are sponsor-assigned — no client reminder
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
      const titles = clientDocs.map((d) => d.checklistItem.title);
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

  // 2. Missing documents — active sponsor accounts
  const sponsors = await db.client.findMany({
    where: {
      sponsorForClientId: { not: null },
      closedAt: null,
      remindersPaused: false,
      reminderCount: { lt: MAX_MISSING },
      OR: [{ lastReminderAt: { lte: due } }, { lastReminderAt: null, createdAt: { lte: due } }],
    },
    include: {
      firm: true,
      sponsorForClient: {
        include: { documents: { where: missingWhere, include: { checklistItem: true } } },
      },
    },
  });
  for (const s of sponsors) {
    if (!s.sponsorForClient) continue;
    // Fetch-then-filter: resolvedOwner(sponsorActive=true) because we only have active sponsors
    const sponsorDocs = s.sponsorForClient.documents.filter((d) => resolvedOwner(d, true) === "SPONSOR");
    if (!sponsorDocs.length) continue;
    const claimed = await db.client.updateMany({
      where: { id: s.id, reminderCount: s.reminderCount, lastReminderAt: s.lastReminderAt },
      data: { reminderCount: { increment: 1 }, lastReminderAt: now },
    });
    if (!claimed.count) continue;
    const titles = sponsorDocs.map((d) => d.checklistItem.title);
    const list = titles.slice(0, 8).map((t) => `• ${t}`).join("\n") + (titles.length > 8 ? `\n• and ${titles.length - 8} more` : "");
    const sent = await sendSafely({
      to: s.email,
      brand: s.firm.name,
      subject: `Reminder: documents still needed for the visa application`,
      text: `${s.firm.name} is still waiting for:\n\n${list}\n\nPlease upload these documents to the partner portal.`,
      action: { label: "Open partner portal", url: `${appUrl()}/` },
    });
    await audit({ firmId: s.firmId, actorType: "SYSTEM", action: sent ? "sponsor.reminder" : "client.reminder.failed", targetId: s.id });
    if (sent) result.missing++;
  }

  // 3. "Please redo" — one reminder each, grouped by recipient
  const redoDue = new Date(now.getTime() - REDO_AFTER_DAYS * DAY);
  const redoDocs = await db.clientDocument.findMany({
    where: {
      status: "REDO", redoSince: { lte: redoDue }, redoRemindedAt: null,
      client: { closedAt: null, remindersPaused: false, accountCreatedAt: { not: null } },
    },
    include: {
      checklistItem: true,
      client: { include: { firm: true, sponsorAccounts: { where: { closedAt: null }, select: { id: true, email: true, firmId: true } } } },
    },
  });
  // Group by (mainClientId, recipientKey). Recipient is "client" for CLIENT-assigned, or sponsor.id for SPONSOR-assigned.
  const byRecipient = new Map<string, { docs: typeof redoDocs; toEmail: string; firmId: string; brand: string; isSponsor: boolean }>();
  for (const d of redoDocs) {
    const claimed = await db.clientDocument.updateMany({ where: { id: d.id, redoRemindedAt: null }, data: { redoRemindedAt: now } });
    if (!claimed.count) continue; // another server got it
    const sponsorActive = d.client.sponsorAccounts.length > 0;
    const owner = resolvedOwner(d, sponsorActive);
    let recipientKey: string;
    let toEmail: string;
    let isSponsor: boolean;
    if (owner === "SPONSOR" && d.client.sponsorAccounts[0]) {
      const sp = d.client.sponsorAccounts[0];
      recipientKey = `${d.clientId}:${sp.id}`;
      toEmail = sp.email;
      isSponsor = true;
    } else {
      recipientKey = `${d.clientId}:client`;
      toEmail = d.client.email;
      isSponsor = false;
    }
    const existing = byRecipient.get(recipientKey);
    if (existing) existing.docs.push(d);
    else byRecipient.set(recipientKey, { docs: [d], toEmail, firmId: d.client.firmId, brand: d.client.firm.name, isSponsor });
  }
  for (const { docs, toEmail, firmId, brand, isSponsor } of byRecipient.values()) {
    const lines = docs.map((d) => `• ${d.checklistItem.title}`).join("\n");
    const sent = await sendSafely({
      to: toEmail,
      brand,
      subject: `Reminder: please re-upload ${docs.length === 1 ? docs[0].checklistItem.title : `${docs.length} documents`}`,
      text: `${brand} asked for these documents to be uploaded again:\n\n${lines}`,
      action: { label: isSponsor ? "Open partner portal" : "Open client portal", url: `${appUrl()}/` },
    });
    const mainClientId = docs[0].clientId;
    await audit({ firmId, actorType: "SYSTEM", action: sent ? (isSponsor ? "sponsor.reminder.redo" : "client.reminder.redo") : "client.reminder.failed", targetId: mainClientId });
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
