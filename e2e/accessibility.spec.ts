/**
 * Accessibility and multi-viewport checks for the client portal.
 *
 * Covers every client-facing screen at iPhone (375 px) and Android (360 px):
 *   - All visible inputs have an accessible name (label, aria-label, or aria-labelledby)
 *   - All visible buttons have an accessible name (text or aria-label)
 *   - Key screens are reachable and readable at each width
 *   - Keyboard tab order reaches core inputs
 *
 * Runs after the main journeys suite so Amina's seeded account is available.
 */

import { test, expect, type Page, type Cookie } from "@playwright/test";
import { E2E } from "./env";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function checkInputsLabelled(page: Page) {
  const violations = await page.evaluate((): string[] => {
    const unlabelled: string[] = [];
    for (const el of Array.from(document.querySelectorAll("input:not([type=hidden])"))) {
      const input = el as HTMLInputElement;
      if (!(input.offsetParent)) continue; // hidden or display:none
      const hasLabel = (input.labels?.length ?? 0) > 0;
      const hasAria = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
      if (!hasLabel && !hasAria) {
        unlabelled.push(`<input type="${input.type}" name="${input.name}" id="${input.id}">`);
      }
    }
    return unlabelled;
  });
  expect(violations, `Unlabelled inputs: ${violations.join("; ")}`).toHaveLength(0);
}

async function checkButtonsNamed(page: Page) {
  const violations = await page.evaluate((): string[] => {
    const unnamed: string[] = [];
    for (const btn of Array.from(document.querySelectorAll("button"))) {
      if (!btn.offsetParent) continue;
      const text = btn.textContent?.trim() ?? "";
      const ariaLabel = btn.getAttribute("aria-label") ?? "";
      const ariaLabelledBy = btn.getAttribute("aria-labelledby") ?? "";
      if (!text && !ariaLabel && !ariaLabelledBy) {
        unnamed.push(`<button class="${btn.className.slice(0, 40)}">`);
      }
    }
    return unnamed;
  });
  expect(violations, `Buttons without accessible names: ${violations.join("; ")}`).toHaveLength(0);
}

// ─── viewports ────────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: "iPhone (375 × 667)", width: 375, height: 667 },
  { name: "Android (360 × 800)", width: 360, height: 800 },
];

// ─── suites ───────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe.serial(`a11y — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    // Sign in as Amina once per viewport — reused across all portal tests in this
    // block so the total client-login count stays well under the 20/15 min limit.
    let aminaCookies: Cookie[] = [];

    test.beforeAll(async ({ playwright }) => {
      const ctx = await playwright.request.newContext({
        baseURL: E2E.APP_URL,
        extraHTTPHeaders: { Origin: E2E.APP_URL },
      });
      const loginRes = await ctx.post("/api/auth/client/login", {
        data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD },
      });
      expect(loginRes.ok(), `Amina login failed (${loginRes.status()}) — check seed and rate limits`).toBe(true);
      aminaCookies = (await ctx.storageState()).cookies;
      await ctx.dispose();
    });

    // ── client sign-in page ──────────────────────────────────────────────────
    // These three tests visit the public sign-in page only — no Amina session needed.

    test(`[${vp.width}px] sign-in: inputs labelled and buttons named`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Client sign in" })).toBeVisible();
      await checkInputsLabelled(page);
      await checkButtonsNamed(page);
    });

    test(`[${vp.width}px] sign-in: keyboard tab reaches email input`, async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Client sign in" })).toBeVisible();
      // Tab enough times to reach the email field (max 5 tabs from body)
      let foundEmail = false;
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        const activeType = await page.evaluate(() => {
          const el = document.activeElement as HTMLInputElement | null;
          return el?.type ?? el?.tagName ?? "";
        });
        if (activeType === "email" || activeType === "text") {
          foundEmail = true;
          break;
        }
      }
      expect(foundEmail, "Tab should reach the email input within 5 key presses").toBe(true);
    });

    test(`[${vp.width}px] OTP sign-in: inputs labelled`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /Email me a sign-in code/i }).click();
      await expect(page.getByRole("heading", { name: "Email me a sign-in code" })).toBeVisible();
      await checkInputsLabelled(page);
      await checkButtonsNamed(page);
    });

    // ── client portal ────────────────────────────────────────────────────────
    // The four tests below reuse aminaCookies (set once in beforeAll above).

    test(`[${vp.width}px] portal Documents tab: buttons named`, async ({ browser }) => {
      const browserCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await browserCtx.addCookies(aminaCookies);
      const page = await browserCtx.newPage();

      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Hello Amina/ })).toBeVisible();
      await checkButtonsNamed(page);
      await browserCtx.close();
    });

    test(`[${vp.width}px] portal Documents tab: group and doc buttons visible`, async ({ browser }) => {
      const browserCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await browserCtx.addCookies(aminaCookies);
      const page = await browserCtx.newPage();

      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Hello Amina/ })).toBeVisible();

      // At least one document group button is visible
      await expect(page.getByRole("button", { name: /^Identity/ }).first()).toBeVisible();

      // Open a group and check a doc button is visible
      await page.getByRole("button", { name: /^Identity/ }).first().click();
      await expect(page.getByRole("button", { name: /Passport/ }).first()).toBeVisible();
      await browserCtx.close();
    });

    test(`[${vp.width}px] portal Visa tab: stage timeline readable`, async ({ browser }) => {
      const browserCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await browserCtx.addCookies(aminaCookies);
      const page = await browserCtx.newPage();

      await page.goto("/");
      await page.getByRole("tab", { name: "Visa" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Where is my case?" })).toBeVisible();
      // All 5 stage labels must fit in the viewport
      for (const label of [
        "Sending documents",
        "Lawyer checking",
        "Ready to submit",
        "Submitted",
        "Decision",
      ]) {
        await expect(page.getByText(label)).toBeVisible();
      }
      await browserCtx.close();
    });

    test(`[${vp.width}px] portal Profile tab: no placeholder rows`, async ({ browser }) => {
      const browserCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await browserCtx.addCookies(aminaCookies);
      const page = await browserCtx.newPage();

      await page.goto("/");
      await page.getByRole("tab", { name: "Profile" }).click();
      await expect(page.getByText("Personal details")).toBeVisible();
      await expect(page.getByText("Family details")).toHaveCount(0);
      await expect(page.getByText("Client agreement")).toHaveCount(0);
      await browserCtx.close();
    });

    test(`[${vp.width}px] portal Help tab and sign-out button accessible`, async ({ browser }) => {
      const browserCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await browserCtx.addCookies(aminaCookies);
      const page = await browserCtx.newPage();

      await page.goto("/");
      await page.getByRole("tab", { name: "Help" }).click();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await checkButtonsNamed(page);
      await browserCtx.close();
    });
  });
}
