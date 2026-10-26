import path from "node:path";
import os from "node:os";

/** Everything the end-to-end tests run with: a separate database, folders and fake services. Never real data. */
const root = path.resolve(__dirname, "..");
export const E2E_PORT = 3100;
export const E2E = {
  DATABASE_URL: `postgresql://${os.userInfo().username}@localhost:5432/visasteps_test`,
  APP_URL: `http://localhost:${E2E_PORT}`,
  AUTH_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only-secret",
  EMAIL_PROVIDER: "file",
  EMAIL_FILE_DIR: path.join(root, "e2e-mail"),
  STORAGE_PROVIDER: "fake",
  LOCAL_STORAGE_DIR: path.join(root, "e2e-storage"),
  UPLOAD_QUEUE_DIR: path.join(root, "e2e-queue"),
  SMS_PROVIDER: "off",
  VIRUS_SCAN: "off",
  SEED_STAFF_PASSWORD: "e2e-caseworker-password",
  SEED_CLIENT_PASSWORD: "e2e-client-password",
  SEED_ADMIN_PASSWORD: "e2e-admin-password-long",
  CRON_SECRET: "e2e-cron-secret-value",
  AI_PROVIDER: "fake",
} as const;
