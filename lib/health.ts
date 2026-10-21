import { db } from "./db";
import { ping, scanningEnabled } from "./virus";
import { getConnection } from "./onedrive-connection";

const HOUR = 3_600_000;
export const backupsConfigured = () => !!process.env.BACKUP_AGE_RECIPIENT;

/** Hours since the last successful nightly backup (null if none recorded). */
export async function backupAgeHours(): Promise<number | null> {
  const last = await db.auditLog.findFirst({ where: { action: "ops.backup.ok" }, orderBy: { at: "desc" }, select: { at: true } });
  return last ? (Date.now() - last.at.getTime()) / HOUR : null;
}

/** For /api/health and the uptime monitor. Reports only states, never data. */
export async function health() {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
    ok = false;
  }
  if (scanningEnabled()) {
    checks.virusScanner = (await ping()) ? "ok" : "down";
    if (checks.virusScanner !== "ok") ok = false;
  }
  if (process.env.STORAGE_PROVIDER === "onedrive" && checks.database === "ok") {
    const c = await getConnection().catch(() => null);
    checks.oneDrive = !c?.refreshToken ? "not connected" : c.status === "reconnect" ? "reconnect needed" : "ok";
    if (checks.oneDrive !== "ok") ok = false;
  }
  if (backupsConfigured() && checks.database === "ok") {
    const age = await backupAgeHours();
    checks.backup = age === null ? "none yet" : age > 26 ? `late (${Math.round(age)}h)` : "ok";
  }
  if (checks.database === "ok") {
    const stuck = await db.fileUpload.count({ where: { storageStatus: "FAILED" } });
    checks.filesNotSaved = String(stuck);
  }
  return { ok, checks };
}
