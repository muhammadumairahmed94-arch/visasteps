/**
 * Nightly encrypted database backup → OneDrive (Apps → UHA Legal Client Portal → Backups).
 *   npx tsx scripts/backup.mts          run once now
 *   deploy/backup-loop.sh               run every night at 02:30 UK time (the "backup" service)
 * The dump is encrypted with the owner's PUBLIC age key (BACKUP_AGE_RECIPIENT) before it leaves the server;
 * only the private key in the owner's password manager can open it. Keeps 30 days.
 */
import { spawn } from "node:child_process";
import { db } from "../lib/db";
import { storage } from "../lib/adapters/storage";
import { notifyOps } from "../lib/alerts";

const FOLDER = ["Backups"];
const KEEP_DAYS = 30;

function run(cmd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 300)}`))));
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

const ukStamp = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .replace(", ", "_")
    .replace(":", "");

async function record(ok: boolean, detail: string) {
  const firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (firm) await db.auditLog.create({ data: { firmId: firm.id, actorType: "SYSTEM", action: ok ? "ops.backup.ok" : "ops.backup.failed", targetId: detail.slice(0, 120) } });
  if (!ok) await notifyOps("backup-failed", "last night's backup failed", `The nightly database backup did not complete: ${detail}\nCheck on the server: docker compose logs backup`, 12 * 60);
}

export async function backupOnce() {
  const recipient = process.env.BACKUP_AGE_RECIPIENT;
  if (!recipient?.startsWith("age1")) throw new Error("BACKUP_AGE_RECIPIENT (the age1… public key) is not set");
  const dump = await run("pg_dump", ["--format=custom", "--no-owner", process.env.DATABASE_URL!]);
  const sealed = await run("age", ["-r", recipient], dump);
  const name = `visasteps_${ukStamp()}.dump.age`;
  const store = storage();
  await store.save(FOLDER, name, sealed);

  // Retention: delete backups older than KEEP_DAYS (names carry the date)
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const f of await store.list(FOLDER)) {
    const day = f.name.match(/^visasteps_(\d{4}-\d{2}-\d{2})_/)?.[1];
    if (day && day < cutoff) await store.remove(f.itemId);
  }
  return `${name} (${Math.round(sealed.length / 1024)} KB)`;
}

async function attempt() {
  try {
    const what = await backupOnce();
    await record(true, what);
    console.log(`Backup saved: ${what}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Backup failed: ${msg}`);
    await record(false, msg).catch(() => undefined);
    return false;
  }
  return true;
}

/** Milliseconds until the next 02:30 Europe/London. */
function untilNext(hh = 2, mm = 30) {
  const now = new Date();
  for (let h = 0; h < 48; h++) {
    const t = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000 + h * 3_600_000 + mm * 60_000);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
    if (parts === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` && t > now) return t.getTime() - now.getTime();
  }
  return 24 * 3_600_000;
}

if (process.argv.includes("--seconds-until-next")) {
  // Used by deploy/backup-loop.sh, which sleeps in the shell so no Node process idles all day
  console.log(Math.ceil(untilNext() / 1000));
  await db.$disconnect();
} else {
  const ok = await attempt();
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}
