import { keepAlive, processQueue } from "./storage-queue";
import { sendDueReminders } from "./reminders";
import { purgeExpiredUploadSessions } from "./upload-sessions";
import { backupAgeHours, backupsConfigured } from "./health";
import { notifyOps } from "./alerts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Background work for a long-running server: OneDrive retries every minute, reminders every 15 minutes.
 * Hosts without one call /api/jobs/storage and /api/jobs/reminders on a schedule instead.
 */
export function startBackgroundJobs() {
  const g = globalThis as unknown as { jobsTimer?: NodeJS.Timeout; lastReminders?: number };
  if (g.jobsTimer) return;
  (globalThis as unknown as { jobsStartedAt?: number }).jobsStartedAt = Date.now();
  g.jobsTimer = setInterval(async () => {
    try {
      await keepAlive();
      await processQueue();
      if (!g.lastReminders || Date.now() - g.lastReminders > 15 * 60_000) {
        g.lastReminders = Date.now();
        const r = await sendDueReminders();
        if (r.missing || r.redo) console.log(`Reminders sent: ${r.missing} missing-documents, ${r.redo} re-upload`);
        await purgeExpiredUploadSessions();
        // Backups: alert if none has succeeded for 26 hours (the job runs nightly)
        if (backupsConfigured()) {
          const age = await backupAgeHours();
          const started = (globalThis as unknown as { jobsStartedAt?: number }).jobsStartedAt ?? Date.now();
          if ((age === null && Date.now() - started > 26 * 3_600_000) || (age !== null && age > 26))
            await notifyOps("backup-missing", "no successful backup in over a day", `The last successful nightly backup was ${age === null ? "never recorded" : `${Math.round(age)} hours ago`}.\nCheck on the server: docker compose logs backup`, 24 * 60);
        }
      }
    } catch (e) {
      console.error("Background jobs:", errText(e));
    }
  }, 60_000);
  g.jobsTimer.unref?.();
}
