import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E } from "./env";

/** Test database (visasteps_test, used only by these tests) and folders, reset to the demo seed before every run. */
export default function globalSetup() {
  const env = { ...process.env, ...E2E };
  try {
    execSync("/opt/homebrew/opt/postgresql@16/bin/createdb visasteps_test", { stdio: "ignore" });
  } catch {
    /* already exists */
  }
  for (const d of [E2E.EMAIL_FILE_DIR, E2E.LOCAL_STORAGE_DIR, E2E.UPLOAD_QUEUE_DIR]) rmSync(d, { recursive: true, force: true });
  execSync("npx prisma migrate deploy", { env, stdio: "ignore" }); // applies migrations; never deletes data
  execSync("npx tsx prisma/seed.ts", { env, stdio: "ignore" });
}
