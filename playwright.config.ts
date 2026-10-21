import { defineConfig, devices } from "@playwright/test";
import { E2E, E2E_PORT } from "./e2e/env";

/** End-to-end tests: npm run test:e2e (builds the portal and runs it on port 3100 against the test database). */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: E2E.APP_URL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Same self-contained server the Docker image runs (output: "standalone")
    command: "npx next build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js",
    url: E2E.APP_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { ...E2E, PORT: String(E2E_PORT), HOSTNAME: "127.0.0.1" },
  },
});
