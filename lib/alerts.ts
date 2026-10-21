import { sendSafely } from "./adapters/email";

/**
 * Operational alerts to ALERT_EMAIL (portal errors, OneDrive disconnected, virus scanner down, backups).
 * Each kind of alert is sent at most once per `everyMinutes`, so a burst of errors is one email, not hundreds.
 * Alerts never include client documents or personal details — only what broke and where.
 */
const lastSent = new Map<string, number>();

export async function notifyOps(key: string, subject: string, text: string, everyMinutes = 60) {
  const to = process.env.ALERT_EMAIL;
  if (!to) return;
  const now = Date.now();
  if ((lastSent.get(key) ?? 0) > now - everyMinutes * 60_000) return;
  lastSent.set(key, now);
  await sendSafely({
    to,
    brand: "UHA Legal client portal",
    subject: `Portal alert: ${subject}`,
    text: `${text.slice(0, 1500)}\n\nTime: ${new Date().toISOString()}\nServer: ${process.env.APP_URL ?? "unknown"}`,
  });
}
