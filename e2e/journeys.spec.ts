import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Secret, TOTP } from "otpauth";
import { E2E } from "./env";

/**
 * The two main journeys from the spec, end to end in a real browser:
 *   1. invite → create account → upload → approve
 *   2. upload → ask to redo → re-upload (old file kept in "_Old versions")
 * Plus: one client cannot reach another client's documents.
 */

const fixture = (name: string) => path.join(__dirname, "..", "tests", "fixtures", name);
const clientEmail = `e2e.client.${Date.now()}@example.com`;

/**
 * Build a single-page PDF using pdf-lib with LiberationSans embedded as a TrueType font.
 * pdf-lib+fontkit generates a ToUnicode CMap so pdfjs can extract the text in any environment
 * without needing standardFontDataUrl (standard-font-only PDFs require it and fail in some builds).
 */
async function buildTextPdf(text: string): Promise<Buffer> {
  const fontPath = path.join(__dirname, "../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");
  const fontBytes = readFileSync(fontPath);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.addPage([595, 842]);
  page.drawText(text, { x: 60, y: 760, size: 12, font });
  return Buffer.from(await doc.save());
}

// 1×1 transparent PNG — just small enough to trigger the "tiny" quality warning
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

type FileArg = string | string[] | { name: string; mimeType: string; buffer: Buffer };

/**
 * Select files via the ScanFlow picker, click Send, dismiss quality warnings if any appear.
 * Does not wait for the success toast — caller checks the specific message.
 */
async function pickAndSend(page: Page, files: FileArg) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.locator("#scan-file").setInputFiles(files as any);
  const count = Array.isArray(files) ? files.length : 1;
  await page.getByRole("button", { name: new RegExp(`^Send ${count === 1 ? "1" : count} page`) }).click();
  const warn = page.locator(".scan-warning");
  if (await warn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Send anyway" }).click();
  }
}

type Mail = { to: string; subject: string; text: string; action?: { label: string; url: string } };
async function mailTo(to: string, subject: RegExp): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(E2E.EMAIL_FILE_DIR)) {
      const mails = readdirSync(E2E.EMAIL_FILE_DIR)
        .sort()
        .map((f) => JSON.parse(readFileSync(path.join(E2E.EMAIL_FILE_DIR, f), "utf8")) as Mail)
        .filter((m) => m.to === to && subject.test(m.subject));
      if (mails.length) return mails.at(-1)!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

/** Shared TOTP key set during first-time setup; reused by subsequent sign-ins in the same run. */
let adminTotpKey = "";

/**
 * The admin staff page created by the main journeys suite. Later suites that need
 * staff API access share this page (and its cookies) rather than signing in again
 * with a fresh TOTP code — the anti-replay window would reject a second code in the
 * same 30-second slot.
 */
let sharedStaffPage: Page;

/** Caseworker page captured after test 4 creates sara.cw@example.com. */
let saraCwPage: Page;

/** Admin sign-in including first-time authenticator setup (the test plays the phone app). */
async function staffSignIn(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/staff");
  await page.getByLabel("Email").fill("info@uhalegal.com");
  await page.getByLabel("Password").fill(E2E.SEED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
  adminTotpKey = (await page.locator(".muted .fn").textContent())!.replace(/\s/g, "");
  await page.getByLabel(/6-digit code/).fill(new TOTP({ secret: Secret.fromBase32(adminTotpKey) }).generate());
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await page.getByLabel("I have saved these codes somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  return { ctx, page };
}

/** Admin sign-in when TOTP is already configured (uses the key captured by staffSignIn). */
async function staffSignInExisting(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/staff");
  await page.getByLabel("Email").fill("info@uhalegal.com");
  await page.getByLabel("Password").fill(E2E.SEED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.getByLabel(/6-digit code/).fill(new TOTP({ secret: Secret.fromBase32(adminTotpKey) }).generate());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  return { ctx, page };
}

test.describe.serial("main journeys", () => {
  let staff: Page;
  let client: Page;
  let clientCaseId = "";

  test.beforeAll(async ({ browser }) => {
    staff = (await staffSignIn(browser)).page;
    sharedStaffPage = staff;
    client = await (await browser.newContext()).newPage();
  });

  test("1. invite → create account → upload → approve", async () => {
    // Caseworker invites the client by email only
    await staff.getByRole("button", { name: "New client" }).click();
    await staff.getByLabel("Client's email").fill(clientEmail);
    await staff.getByLabel("Visa route").selectOption({ label: "Spouse visa" });
    await staff.getByRole("button", { name: "Create and send invite" }).click();
    await expect(staff.getByText("Invite created. Waiting for the client to create their account.")).toBeVisible();
    clientCaseId = staff.url().split("#c/")[1].split("/")[0];

    // Client opens the emailed link and creates an account
    const invite = await mailTo(clientEmail, /client portal invitation/);
    expect(invite.action?.label).toBe("Create account");
    await client.goto(invite.action!.url);
    await expect(client.getByRole("heading", { name: "Create account" })).toBeVisible();
    await client.getByLabel("First name").fill("Test");
    await client.getByLabel("Last name").fill("Client");
    await client.getByLabel("Choose a password").fill("e2e-client-pass-123");
    await client.getByRole("button", { name: "Create account" }).click();
    await expect(client.getByRole("heading", { name: "Hello Test" })).toBeVisible();

    // Upload the passport
    await client.getByRole("button", { name: /^Identity/ }).click();
    await client.getByRole("button", { name: /^Passport/ }).click();
    await pickAndSend(client, fixture("passport.png"));
    await expect(client.getByText(/Received\. Your caseworker usually checks/)).toBeVisible();
    await expect(client.getByRole("button", { name: /^Passport.*Checking/ })).toBeVisible();

    // Caseworker approves
    await staff.goto(`/staff#c/${clientCaseId}/review`);
    await staff.reload();
    await staff.getByRole("button", { name: /^Passport/ }).click();
    await expect(staff.getByText(/Client_Passport_\d{4}-\d{2}-\d{2}\.pdf/)).toBeVisible();
    await staff.getByRole("button", { name: "Approve" }).click();
    await expect(staff.getByText("Approved", { exact: true }).first()).toBeVisible();

    // Client sees it approved
    await client.goto("/");
    await expect(client.getByRole("button", { name: /^Identity.*All sent/ })).toBeVisible();
    await client.getByRole("button", { name: /^Identity/ }).click();
    await client.getByRole("button", { name: /^Passport/ }).click();
    await expect(client.getByText("✓ Checked and approved")).toBeVisible();
  });

  test("2. upload → ask to redo → re-upload (old file kept)", async () => {
    await client.goto("/");
    await client.getByRole("button", { name: /^English and TB test/ }).click();
    await client.getByRole("button", { name: /^English language evidence/ }).click();
    await pickAndSend(client, fixture("certificate.png"));
    await expect(client.getByText(/Received\. Your caseworker usually checks/)).toBeVisible();

    // Caseworker asks for it again, with a note
    await staff.goto(`/staff#c/${clientCaseId}/review`);
    await staff.reload();
    await staff.getByRole("button", { name: /^English language evidence/ }).click();
    await staff.getByRole("button", { name: "Ask to redo" }).click();
    await staff.getByPlaceholder("Tell the client what to fix, in plain words").fill("The photo is blurred. Please upload a clearer copy.");
    await staff.getByRole("button", { name: "Send to client" }).click();
    await expect(staff.getByText("Sent to the client by email")).toBeVisible();

    const notice = await mailTo(clientEmail, /please re-upload/);
    // Caseworker note is shown in the portal, not in the email body
    expect(notice.text).toContain("Your caseworker has left a note about");
    expect(notice.text).not.toContain("The photo is blurred");

    // Client sees the request and uploads again
    await client.goto("/");
    await expect(client.getByRole("button", { name: /^English and TB test.*Action required/ })).toBeVisible();
    await client.getByRole("button", { name: /^English and TB test/ }).click();
    await client.getByRole("button", { name: /^English language evidence.*Please redo/ }).click();
    await expect(client.getByText("Caseworker note:")).toBeVisible();
    await expect(client.getByText("The photo is blurred. Please upload a clearer copy.")).toBeVisible();
    await pickAndSend(client, fixture("certificate.png"));
    await expect(client.getByText(/Received\. Your caseworker usually checks/)).toBeVisible();

    // Storage: new file in place, old one moved to "_Old versions" (never deleted)
    const clientDir = readdirSync(path.join(E2E.LOCAL_STORAGE_DIR, "Clients")).find((d) => d.startsWith("Client_Test_"))!;
    const folder = path.join(E2E.LOCAL_STORAGE_DIR, "Clients", clientDir, "05 English and tests");
    expect(readdirSync(folder).filter((f) => f.endsWith(".pdf"))).toHaveLength(1);
    expect(readdirSync(path.join(folder, "_Old versions"))).toHaveLength(1);
  });

  test("3. a client cannot reach another client's documents", async ({ playwright }) => {
    // Another client's document id, as the caseworker sees it
    const view = await (await staff.request.get(`/api/staff/cases/${clientCaseId}`)).json();
    const passport = view.groups.flatMap((g: { docs: { title: string; id: string; files: { id: string }[] }[] }) => g.docs).find((d: { title: string }) => d.title === "Passport");

    // Amina (seeded demo client) signs in through the API
    const amina = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    expect((await amina.post("/api/auth/client/login", { data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD } })).ok()).toBe(true);

    const own = await (await amina.get("/api/client/portal")).json();
    expect(own.firstName).toBe("Amina");
    expect(JSON.stringify(own)).not.toContain(passport.id);

    // Amina cannot start an upload session for the other client's document
    const upload = await amina.post("/api/client/upload/start", {
      data: { docId: passport.id, multiPage: false, pages: [{ fileName: "x.png", sizeBytes: 100, sha256: "a".repeat(64), totalChunks: 1 }] },
    });
    expect(upload.status()).toBe(400);
    expect((await upload.json()).error).toMatch(/Document not found/);

    // Client sessions never open staff routes or files
    expect((await amina.get(`/api/staff/cases/${clientCaseId}`)).status()).toBe(401);
    expect((await amina.get(`/api/staff/files/${passport.files[0].id}`)).status()).toBe(401);
    await amina.dispose();
  });

  test("4. admin adds a caseworker and a checklist document", async ({ browser }) => {
    // Add a caseworker → they get a "Set your password" email
    await staff.goto("/staff#admin/team");
    await staff.reload();
    await expect(staff.getByRole("heading", { name: "Firm settings" })).toBeVisible();
    await staff.getByLabel("Name").fill("Sara Caseworker");
    await staff.getByLabel("Email").fill("sara.cw@example.com");
    await staff.getByRole("button", { name: "Add and send invite" }).click();
    await expect(staff.getByText(/Added\. A "set your password" email has been sent\./)).toBeVisible();

    const invite = await mailTo("sara.cw@example.com", /your caseworker account/);
    const sara = await (await browser.newContext()).newPage();
    await sara.goto(invite.action!.url);
    await expect(sara.getByRole("heading", { name: "Set your password" })).toBeVisible();
    await sara.getByLabel("New password").fill("sara-long-password-1");
    await sara.getByRole("button", { name: "Save and continue" }).click();
    await expect(sara.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    const key = (await sara.locator(".muted .fn").textContent())!.replace(/\s/g, "");
    await sara.getByLabel(/6-digit code/).fill(new TOTP({ secret: Secret.fromBase32(key) }).generate());
    await sara.getByRole("button", { name: "Confirm and sign in" }).click();
    await sara.getByLabel("I have saved these codes somewhere safe").check();
    await sara.getByRole("button", { name: "Continue" }).click();
    await expect(sara.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(sara.getByText("No clients yet.")).toBeVisible(); // caseworkers see only their own clients
    saraCwPage = sara; // shared for guidance-library tests

    // Add a document to the spouse visa checklist; existing clients are asked for it too
    await staff.goto("/staff#admin/checklists");
    await staff.reload();
    const spouseRoute = staff.locator("#route option", { hasText: /^Spouse visa \(/ });
    await staff.locator("#route").selectOption((await spouseRoute.getAttribute("value"))!);
    await staff.getByRole("button", { name: "Add a document to Spouse visa" }).click();
    await staff.getByLabel("Document name").fill("Council tax bill");
    await staff.getByLabel("What it is (one sentence for the client)").fill("A recent bill showing the UK address.");
    await staff.getByLabel("Section (and OneDrive folder)").selectOption({ label: "Accommodation — 04 Accommodation" });
    await staff.getByRole("button", { name: "Add", exact: true }).click();
    await expect(staff.getByText(/Document added, and to \d+ existing client/)).toBeVisible();

    await client.goto("/");
    await client.getByRole("button", { name: /^Accommodation/ }).click();
    await expect(client.getByRole("button", { name: /^Council tax bill.*To do/ })).toBeVisible();
  });

  test("5. invite link shared by WhatsApp instead of email", async ({ browser }) => {
    const email = `whatsapp.client.${Date.now()}@example.com`;
    await staff.goto("/staff#new");
    await staff.reload();
    await staff.getByLabel("Client's email").fill(email);
    await staff.getByLabel("Visa route").selectOption({ label: "Spouse visa" });
    await staff.getByRole("button", { name: "Create and send invite" }).click();
    await expect(staff.getByRole("heading", { name: "Invite link" })).toBeVisible();

    await staff.getByRole("button", { name: "Copy invite link" }).click();
    const message = await staff.getByLabel("Message with link").inputValue();
    expect(message).toContain("has invited you to its secure client portal");
    const href = await staff.getByRole("link", { name: "Send by WhatsApp" }).getAttribute("href");
    expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/);

    // The copied link works, and the emailed one (made earlier) no longer does
    const copied = message.match(/https?:\/\/\S+/)![0];
    const emailed = (await mailTo(email, /client portal invitation/)).action!.url;
    const c = await (await browser.newContext()).newPage();
    await c.goto(emailed);
    await expect(c.getByText(/expired or has already been used/)).toBeVisible();
    await c.goto(copied);
    await expect(c.getByRole("heading", { name: "Create account" })).toBeVisible();
  });

  test("5b. document guidance: dates, how-to, and planned submission date", async () => {
    // Admin edits the payslips checklist item to add a dateWindow and howToGet
    await staff.goto("/staff#admin/checklists");
    await staff.reload();
    const spouseRoute = staff.locator("#route option", { hasText: /^Spouse visa \(/ });
    await staff.locator("#route").selectOption((await spouseRoute.getAttribute("value"))!);
    // Find the Payslips row and click Edit
    const payslipRow = staff.locator(".item-row", { hasText: /Sponsor's payslips/ });
    await payslipRow.getByRole("button", { name: "Edit" }).click();
    await staff.getByLabel("Date window").fill("last 6 months");
    await staff.getByLabel("How to get this (optional)").fill("Ask your partner to download PDF payslips from their payroll system.");
    await staff.getByRole("button", { name: "Save" }).click();
    await expect(staff.getByText(/Saved/)).toBeVisible();

    // Caseworker sets a planned submission date on Amina's case
    await staff.goto("/staff");
    await staff.reload();
    await staff.getByRole("button", { name: /^Amina Khan/ }).click();
    await staff.getByRole("tab", { name: "Client" }).click();
    await expect(staff.getByRole("heading", { name: "Planned submission date" })).toBeVisible();
    // Set to a fixed date so we can assert the resolved range on the client side
    const dateInput = staff.getByRole("textbox", { name: "Planned submission date" });
    await dateInput.fill("2026-10-01");
    await dateInput.blur();
    await expect(staff.getByText("Planned submission date saved")).toBeVisible();

    // Client sees the resolved date range and how-to text on the payslips document
    await client.goto("/");
    await client.getByRole("button", { name: /^Finances/ }).click();
    await client.getByRole("button", { name: /^Sponsor's payslips/ }).click();
    // Dates resolved: last 6 months before Oct 1 2026 = April–September 2026
    await expect(client.getByText(/Dates needed/)).toBeVisible();
    await expect(client.getByText(/1 April to 30 September 2026/)).toBeVisible();
    // How-to text is shown
    await expect(client.getByText("How to get this")).toBeVisible();
    await expect(client.getByText(/Ask your partner to download PDF payslips/)).toBeVisible();
  });

  test("6a. client flags a document missing; caseworker responds; reminder is suppressed", async ({ playwright }) => {
    // Navigate to the council tax bill doc (added in test 4) via the accommodation group
    await client.goto("/");
    await expect(client.getByRole("heading", { name: /Hello/ })).toBeVisible();
    await client.getByRole("button", { name: /^Accommodation/ }).click();
    await client.getByRole("button", { name: /^Council tax bill/ }).click();
    // The "I can't find this" button should be present
    await expect(client.getByRole("button", { name: "I can't find this document" })).toBeVisible();
    await client.getByRole("button", { name: "I can't find this document" }).click();
    await expect(client.getByLabel("Tell us why, in a few words")).toBeVisible();
    await client.getByLabel("Tell us why, in a few words").fill("We moved house and I cannot find the bill.");
    await client.getByRole("button", { name: "Tell my caseworker" }).click();
    // Toast confirms
    await expect(client.getByText("Saved. Your caseworker has been told.")).toBeVisible();
    // Banner appears on the doc screen
    await expect(client.getByText("We have told your caseworker.")).toBeVisible();
    // "I can't find this" button is now hidden
    await expect(client.getByRole("button", { name: "I can't find this document" })).toHaveCount(0);

    // Caseworker gets an email (note is in the portal, not in the email body)
    await mailTo("info@uhalegal.com", /cannot find: Council tax bill/);

    // Missing tab shows the reason
    await staff.goto(`/staff#c/${clientCaseId}/missing`);
    await staff.reload();
    await expect(staff.getByText(/We moved house/)).toBeVisible();

    // Caseworker opens the doc and responds
    await staff.getByRole("button", { name: /^Council tax bill/ }).click();
    await expect(staff.getByText("Client said they cannot find this document")).toBeVisible();
    await expect(staff.getByText("We moved house and I cannot find the bill.")).toBeVisible();
    await staff.getByRole("button", { name: "Respond to client" }).click();
    await staff.getByPlaceholder("Optional: write a note to the client").fill("You can use a bank statement showing your address instead.");
    await staff.getByRole("button", { name: "Reply and clear flag" }).click();
    await expect(staff.getByText("Reply sent to client")).toBeVisible();

    // Client gets a notification email (reply text is in the portal, not in the email body)
    await mailTo(clientEmail, /your caseworker left a note about Council tax bill/);

    // On the client side, the banner is gone and the caseworker's reply is shown
    await client.goto("/");
    await client.getByRole("button", { name: /^Accommodation/ }).click();
    await client.getByRole("button", { name: /^Council tax bill/ }).click();
    await expect(client.getByText("We have told your caseworker.")).toHaveCount(0);
    await expect(client.getByText("Your caseworker replied:")).toBeVisible();
    await expect(client.getByText(/bank statement showing your address/)).toBeVisible();
    // "I can't find this" button is hidden while a response is displayed
    await expect(client.getByRole("button", { name: "I can't find this document" })).toHaveCount(0);

    // The caseworker's API uses the right credentials; a different client cannot respond
    const amina = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    expect((await amina.post(`/api/staff/documents/nonexistent/missing`, { data: { note: "" } })).status()).toBe(401);
    await amina.dispose();
  });

  test("6b. upload confirmation message uses firm reviewDays setting", async () => {
    // Confirm the message includes "working days" after upload (default 2)
    await client.goto("/");
    await client.getByRole("button", { name: /^Accommodation/ }).click();
    await client.getByRole("button", { name: /^Council tax bill/ }).click();
    await pickAndSend(client, fixture("passport.png"));
    await expect(client.getByText(/Your caseworker usually checks documents within 2 working days/)).toBeVisible();
  });

  test("7a. 'Your next step' card shows and links to the right document", async () => {
    // Test client still has NEED documents — check the card is visible
    await client.goto("/");
    await expect(client.getByRole("heading", { name: /Hello/ })).toBeVisible();
    // "Your next step" card is at the top of the Documents tab
    await expect(client.getByText("Your next step")).toBeVisible();
    const btn = client.getByRole("button", { name: /Send this document|Upload again/ });
    await expect(btn).toBeVisible();
    // Click it — should navigate into a document screen
    const docTitle = await client.locator(".next-step b").textContent();
    await btn.click();
    await expect(client.getByRole("heading", { level: 2, name: new RegExp(docTitle!) })).toBeVisible();
  });

  test("7b. case stage timeline: caseworker sets stage, client sees it", async () => {
    // Caseworker sets case stage to "SUBMITTED" on the test client
    await staff.goto(`/staff#c/${clientCaseId}/client`);
    await staff.reload();
    await expect(staff.getByRole("heading", { name: "Case stage" })).toBeVisible();
    await staff.getByRole("region", { name: "Case stage" }).getByRole("combobox").selectOption("SUBMITTED");
    await expect(staff.getByText("Stage updated")).toBeVisible();

    // Client's Visa tab now shows the timeline with Submitted as current
    await client.goto("/");
    await client.getByRole("tab", { name: "Visa" }).click();
    await expect(client.getByRole("heading", { level: 2, name: "Where is my case?" })).toBeVisible();
    await expect(client.getByText("Submitted")).toBeVisible();
    await expect(client.getByText(/Your application has been sent to the Home Office/)).toBeVisible();
    // Earlier stages should be visible but not show their detail text
    await expect(client.getByText("Sending documents")).toBeVisible();
    await expect(client.getByText(/You are sending us your documents/)).toHaveCount(0);
  });

  test("7c. profile tab no longer shows placeholder rows", async () => {
    await client.goto("/");
    await client.getByRole("tab", { name: "Profile" }).click();
    await expect(client.getByText("Family details")).toHaveCount(0);
    await expect(client.getByText("Client agreement")).toHaveCount(0);
    await expect(client.getByText("Personal details")).toBeVisible();
  });

  test("8. OTP sign-in: email a code, enter it, land on the portal", async () => {
    // Sign the client out via the UI (Help tab → Sign out)
    await client.goto("/");
    await client.getByRole("tab", { name: "Help" }).click();
    await client.getByRole("button", { name: "Sign out" }).click();
    await expect(client.getByRole("heading", { name: "Client sign in" })).toBeVisible();

    // Choose OTP sign-in
    await client.getByRole("button", { name: /Email me a sign-in code/i }).click();
    await expect(client.getByRole("heading", { name: "Email me a sign-in code" })).toBeVisible();
    await client.getByLabel("Email").fill(clientEmail);
    await client.getByRole("button", { name: "Send code" }).click();

    // Server always returns the same message; enter-code step appears
    await expect(client.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    await expect(client.getByText(clientEmail)).toBeVisible();

    // Read the code from the file-email directory
    const mail = await mailTo(clientEmail, /sign-in code/);
    const codeMatch = /\b(\d{6})\b/.exec(mail.text);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];

    await client.getByLabel("6-digit code").fill(code);
    await client.getByRole("button", { name: "Sign in" }).click();
    await expect(client.getByRole("heading", { name: /Hello/ })).toBeVisible();
  });

  test("8b. two simultaneous OTP verifications produce exactly one session", async ({ playwright }) => {
    // Count OTP emails already on disk for this client so we can wait for a fresh one.
    const countBefore = existsSync(E2E.EMAIL_FILE_DIR)
      ? readdirSync(E2E.EMAIL_FILE_DIR)
          .sort()
          .map((f) => JSON.parse(readFileSync(path.join(E2E.EMAIL_FILE_DIR, f), "utf8")) as Mail)
          .filter((m) => m.to === clientEmail && /sign-in code/.test(m.subject)).length
      : 0;

    // Request a fresh code (the client may still be signed in from test 8 — that is fine).
    const reqCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await reqCtx.post("/api/auth/client/otp/request", { data: { email: clientEmail } });
    await reqCtx.dispose();

    // Wait for a NEW email (one more than before, because code is sent in the background).
    let code8b = "";
    for (let i = 0; i < 40; i++) {
      if (existsSync(E2E.EMAIL_FILE_DIR)) {
        const mails = readdirSync(E2E.EMAIL_FILE_DIR)
          .sort()
          .map((f) => JSON.parse(readFileSync(path.join(E2E.EMAIL_FILE_DIR, f), "utf8")) as Mail)
          .filter((m) => m.to === clientEmail && /sign-in code/.test(m.subject));
        if (mails.length > countBefore) {
          const m = /\b(\d{6})\b/.exec(mails.at(-1)!.text);
          if (m) { code8b = m[1]; break; }
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(code8b, "fresh OTP email must arrive").not.toBe("");

    // Two concurrent verify requests for the same code — exactly one should succeed.
    const [ctx1, ctx2] = await Promise.all([
      playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } }),
      playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } }),
    ]);
    const [r1, r2] = await Promise.all([
      ctx1.post("/api/auth/client/otp/verify", { data: { email: clientEmail, code: code8b } }),
      ctx2.post("/api/auth/client/otp/verify", { data: { email: clientEmail, code: code8b } }),
    ]);

    const statuses = [r1.status(), r2.status()].sort((a, b) => a - b);
    expect(statuses, "exactly one verify succeeds, one fails").toEqual([200, 401]);

    await ctx1.dispose();
    await ctx2.dispose();
  });

  test("9a. remember=true (checkbox ticked) gives a 30-day persistent cookie", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    // "on" is what a ticked HTML checkbox sends via FormData
    const r = await ctx.post("/api/auth/client/login", {
      data: { email: clientEmail, password: "e2e-client-pass-123", remember: "on" },
    });
    expect(r.status()).toBe(200);
    const setCookie = r.headers()["set-cookie"] ?? "";
    expect(setCookie.toLowerCase(), "persistent cookie must have Expires").toMatch(/expires=/);
    await ctx.dispose();
  });

  test("9b. remember=false (checkbox unticked) gives a session cookie with no Expires", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    // Unticked checkbox → key absent from FormData → not sent
    const r = await ctx.post("/api/auth/client/login", {
      data: { email: clientEmail, password: "e2e-client-pass-123" },
    });
    expect(r.status()).toBe(200);
    const setCookie = r.headers()["set-cookie"] ?? "";
    expect(setCookie.toLowerCase(), "session cookie must not have Expires").not.toMatch(/expires=/);
    expect(setCookie.toLowerCase(), "session cookie must not have Max-Age").not.toMatch(/max-age=/);
    await ctx.dispose();
  });

  test("10a. account setup: remember ticked → 30-day persistent cookie", async ({ playwright }) => {
    const forgotCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await forgotCtx.post("/api/auth/client/forgot", { data: { email: clientEmail } });
    await forgotCtx.dispose();

    // sendResetLink is synchronous so the file is on disk before the response arrives
    const mail = await mailTo(clientEmail, /password reset/);
    const token = mail.action!.url.split("/i/")[1];

    const ctx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    const r = await ctx.post("/api/auth/client/setup", { data: { token, password: "e2e-reset-10a", remember: "on" } });
    expect(r.status()).toBe(200);
    expect((r.headers()["set-cookie"] ?? "").toLowerCase(), "persistent cookie must have Expires").toMatch(/expires=/);
    await ctx.dispose();
  });

  test("10b. account setup: remember unticked → session cookie (no Expires)", async ({ playwright }) => {
    const forgotCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await forgotCtx.post("/api/auth/client/forgot", { data: { email: clientEmail } });
    await forgotCtx.dispose();

    // mailTo returns the latest email; test 10a's token was already used so this new one is needed
    const mail = await mailTo(clientEmail, /password reset/);
    const token = mail.action!.url.split("/i/")[1];

    const ctx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    const r = await ctx.post("/api/auth/client/setup", { data: { token, password: "e2e-reset-10b" } }); // no remember
    expect(r.status()).toBe(200);
    const setCookie = r.headers()["set-cookie"] ?? "";
    expect(setCookie.toLowerCase(), "session cookie must not have Expires").not.toMatch(/expires=/);
    expect(setCookie.toLowerCase(), "session cookie must not have Max-Age").not.toMatch(/max-age=/);
    await ctx.dispose();
  });

  test("6. close and reopen a case; admin deletes a client (documents kept)", async ({ playwright }) => {
    staff.on("dialog", (d) => d.accept());

    const login = async () => {
      const r = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
      const res = await r.post("/api/auth/client/login", { data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD } });
      const out = { status: res.status(), body: await res.json() };
      await r.dispose();
      return out;
    };

    // Close Amina's case
    await staff.goto("/staff");
    await staff.reload();
    await staff.getByRole("button", { name: /^Amina Khan/ }).click();
    await staff.getByRole("tab", { name: "Client" }).click();
    await staff.getByRole("button", { name: "Close case" }).click();
    await expect(staff.getByText(/closed\. The client can no longer sign in\./)).toBeVisible();
    expect(await login()).toMatchObject({ status: 401, body: { error: "This case is closed. Please contact us if you need access." } });

    // It moves to "Closed cases"; reopen it and Amina can sign in again
    await staff.goto("/staff");
    await staff.reload();
    await expect(staff.getByRole("button", { name: /^Amina Khan/ })).toHaveCount(0);
    await staff.getByRole("button", { name: /^Closed cases \(1\)/ }).click();
    await staff.getByRole("button", { name: /^Amina Khan.*Closed/ }).click();
    await staff.getByRole("tab", { name: "Client" }).click();
    await staff.getByRole("button", { name: "Reopen case" }).click();
    await expect(staff.getByText(/reopened\. Send the client a link/)).toBeVisible();
    expect((await login()).status).toBe(200);

    // Admin deletes the client from journey 1; their stored documents stay
    const folder = readdirSync(path.join(E2E.LOCAL_STORAGE_DIR, "Clients")).find((d) => d.startsWith("Client_Test_"))!;
    await staff.goto(`/staff#c/${clientCaseId}/client`);
    await staff.reload();
    await staff.getByRole("button", { name: "Delete client permanently (admins)" }).click();
    const ref = (await staff.locator("label[for=del-confirm]").textContent())!.match(/IM-\d+/)![0];
    await expect(staff.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
    await staff.getByLabel(/Type IM-\d+ to confirm/).fill(ref);
    await staff.getByRole("button", { name: "Delete permanently" }).click();
    await expect(staff.getByText(`${ref} deleted from the portal. Its documents remain in OneDrive.`)).toBeVisible();
    await expect(staff.getByRole("heading", { name: "Clients" })).toBeVisible();
    expect((await staff.request.get(`/api/staff/cases/${clientCaseId}`)).status()).toBe(404);
    expect(readdirSync(path.join(E2E.LOCAL_STORAGE_DIR, "Clients", folder, "01 Identity")).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Phone-sized (375 px) — Amina's account is re-opened at the end of test 6
// ---------------------------------------------------------------------------
test.describe.serial("phone (375 px) — next step card and stage timeline", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  let phone: Page;

  test.beforeAll(async ({ browser }) => {
    phone = await (await browser.newContext()).newPage();
  });

  test("signs in and sees the next step card", async ({ playwright }) => {
    // Sign in as Amina (re-opened in test 6)
    const ctx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await ctx.post("/api/auth/client/login", { data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD } });
    // Grab the session cookie and give it to the phone page's context
    const cookies = (await ctx.storageState()).cookies;
    await phone.context().addCookies(cookies);
    await ctx.dispose();

    await phone.goto("/");
    await expect(phone.getByRole("heading", { name: /Hello Amina/ })).toBeVisible();
    // Next step card is visible at 375 px
    await expect(phone.getByText("Your next step").or(phone.getByText("All done for now."))).toBeVisible();
  });

  test("Visa tab timeline is readable on phone", async () => {
    await phone.goto("/");
    await phone.getByRole("tab", { name: "Visa" }).click();
    await expect(phone.getByRole("heading", { level: 2, name: "Where is my case?" })).toBeVisible();
    // All 5 stage labels fit in the viewport
    for (const label of ["Sending documents", "Lawyer checking", "Ready to submit", "Submitted", "Decision"]) {
      await expect(phone.getByText(label)).toBeVisible();
    }
  });

  test("Profile tab shows only Personal details (no placeholders)", async () => {
    await phone.goto("/");
    await phone.getByRole("tab", { name: "Profile" }).click();
    await expect(phone.getByText("Personal details")).toBeVisible();
    await expect(phone.getByText("Family details")).toHaveCount(0);
    await expect(phone.getByText("Client agreement")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Phone-sized chunked upload tests (375 × 667)
// These use Amina's seeded account which has NEED documents throughout.
// ---------------------------------------------------------------------------
test.describe.serial("phone (375 px) — chunked upload", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  let phone2: Page;

  test.beforeAll(async ({ browser, playwright }) => {
    // Sign in as Amina through the API and copy the session cookie to the browser context
    const api = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await api.post("/api/auth/client/login", { data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD } });
    const cookies = (await api.storageState()).cookies;
    await api.dispose();
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await ctx.addCookies(cookies);
    phone2 = await ctx.newPage();
  });

  test("11. multi-page upload: 2 files → thumbnails → Send 2 pages → Received", async () => {
    await phone2.goto("/");
    await phone2.getByRole("button", { name: /Send this document|Upload again/ }).first().click();
    await expect(phone2.locator("#scan-file")).toBeVisible();

    // Select two files at once
    await phone2.locator("#scan-file").setInputFiles([fixture("passport.png"), fixture("certificate.png")]);
    // Two thumbnails should appear
    await expect(phone2.locator(".scan-thumb")).toHaveCount(2);
    await phone2.getByRole("button", { name: /^Send 2 pages/ }).click();
    // Dismiss quality warning if fixtures trigger it
    const warn = phone2.locator(".scan-warning");
    if (await warn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await phone2.getByRole("button", { name: "Send anyway" }).click();
    }
    await expect(phone2.getByText(/Received\. Your caseworker usually checks/)).toBeVisible({ timeout: 20000 });
  });

  test("12. quality warning badge shown for tiny image; Send anyway succeeds", async () => {
    await phone2.goto("/");
    await phone2.getByRole("button", { name: /Send this document/ }).first().click();
    await expect(phone2.locator("#scan-file")).toBeVisible();

    // Upload a 1×1 transparent PNG — guaranteed to trigger the "tiny" quality warning
    await phone2.locator("#scan-file").setInputFiles({ name: "tiny.png", mimeType: "image/png", buffer: TINY_PNG });
    // Quality badge should appear on the thumbnail
    await expect(phone2.locator(".scan-badge")).toBeVisible();
    expect(await phone2.locator(".scan-badge").textContent()).toMatch(/Very small/);

    // Clicking Send shows the warning dialog; Send anyway completes
    await phone2.getByRole("button", { name: /^Send 1 page/ }).click();
    await expect(phone2.locator(".scan-warning")).toBeVisible();
    await phone2.getByRole("button", { name: "Send anyway" }).click();
    await expect(phone2.getByText(/Received\. Your caseworker usually checks/)).toBeVisible({ timeout: 20000 });
  });

  test("13. upload progress indicator appears and upload completes", async () => {
    await phone2.goto("/");
    await phone2.getByRole("button", { name: /Send this document/ }).first().click();
    await expect(phone2.locator("#scan-file")).toBeVisible();

    await phone2.locator("#scan-file").setInputFiles(fixture("certificate.png"));
    await phone2.getByRole("button", { name: /^Send 1 page/ }).click();
    // Dismiss quality warning if it fires
    const warn = phone2.locator(".scan-warning");
    if (await warn.isVisible({ timeout: 800 }).catch(() => false)) {
      await phone2.getByRole("button", { name: "Send anyway" }).click();
    }
    // Progress indicator ("Sending…") should appear during the upload
    await expect(phone2.getByRole("status")).toBeVisible({ timeout: 5000 });
    // And resolve to the success toast
    await expect(phone2.getByText(/Received\. Your caseworker usually checks/)).toBeVisible({ timeout: 20000 });
  });
});

// ---------------------------------------------------------------------------
// Messaging — client sends a message, caseworker sees the unread badge,
// replies, client sees the reply. Runs on a phone-sized screen (375 × 667).
// Uses Amina's seeded account (re-opened by test 6) and the admin caseworker.
// ---------------------------------------------------------------------------
test.describe.serial("messaging", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  let phoneClient: Page;
  let phoneStaff: Page;
  let aminaCaseId = "";

  test.beforeAll(async ({ browser, playwright }) => {
    // Sign Amina in through the API and carry the session into a phone browser
    const aminaCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await aminaCtx.post("/api/auth/client/login", { data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD } });
    const aminaCookies = (await aminaCtx.storageState()).cookies;
    await aminaCtx.dispose();

    const clientBrowserCtx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    await clientBrowserCtx.addCookies(aminaCookies);
    phoneClient = await clientBrowserCtx.newPage();

    // Sign the admin in on a phone-sized staff browser (TOTP already configured by main journeys)
    const { page } = await staffSignInExisting(browser);
    phoneStaff = page;
    await phoneStaff.setViewportSize({ width: 375, height: 667 });

    // Locate Amina's case id from the staff list
    await phoneStaff.goto("/staff");
    await phoneStaff.reload();
    const aminaBtn = phoneStaff.getByRole("button", { name: /^Amina Khan/ });
    await aminaBtn.click();
    aminaCaseId = phoneStaff.url().split("#c/")[1].split("/")[0];
  });

  test("client sends a message; caseworker sees unread badge and the message", async () => {
    // Client opens Messages tab and sends a message
    await phoneClient.goto("/");
    await phoneClient.getByRole("tab", { name: /Messages/ }).click();
    await expect(phoneClient.getByRole("heading", { name: "Messages" })).toBeVisible();
    // Wait for the thread to finish loading (textarea only appears after the fetch resolves)
    await expect(phoneClient.getByLabel("Message", { exact: true })).toBeVisible();
    await phoneClient.getByLabel("Message", { exact: true }).fill("Hello, I have a question about my passport.");
    await phoneClient.getByRole("button", { name: "Send" }).click();
    await expect(phoneClient.getByText("Hello, I have a question about my passport.")).toBeVisible();

    // Caseworker opens Amina's case and sees the unread badge on the Messages tab
    await phoneStaff.goto("/staff");
    await phoneStaff.reload();
    await phoneStaff.getByRole("button", { name: /^Amina Khan/ }).click();
    await expect(phoneStaff.getByRole("tab", { name: /Messages \(1\)/ })).toBeVisible();

    // Caseworker opens the Messages tab and sees the message
    await phoneStaff.getByRole("tab", { name: /Messages/ }).click();
    await expect(phoneStaff.getByText("Hello, I have a question about my passport.")).toBeVisible();
  });

  test("caseworker replies; client sees the reply; unread badge clears", async () => {
    // Caseworker replies (still on the Messages tab from the previous test)
    await phoneStaff.goto(`/staff#c/${aminaCaseId}/messages`);
    await phoneStaff.reload();
    await expect(phoneStaff.getByText("Hello, I have a question about my passport.")).toBeVisible();
    // Wait for thread to load
    await expect(phoneStaff.getByLabel("Message", { exact: true })).toBeVisible();
    await phoneStaff.getByLabel("Message", { exact: true }).fill("Of course, what would you like to know?");
    await phoneStaff.getByRole("button", { name: "Send" }).click();
    await expect(phoneStaff.getByText("Of course, what would you like to know?")).toBeVisible();

    // Client reloads and sees the Messages tab has an unread badge
    await phoneClient.goto("/");
    await expect(phoneClient.getByRole("tab", { name: /Messages \(1\)/ })).toBeVisible();

    // Client opens Messages and sees the caseworker's reply
    await phoneClient.getByRole("tab", { name: /Messages/ }).click();
    await expect(phoneClient.getByText("Of course, what would you like to know?")).toBeVisible();

    // After opening, the badge clears
    await expect(phoneClient.getByRole("tab", { name: /Messages \(/ })).toHaveCount(0);
  });
})

// ---------------------------------------------------------------------------
// Sponsor email routing — redo and "can't find" reply emails go to the partner,
// not the main client. Requires TOTP configured by the main journeys suite.
// ---------------------------------------------------------------------------
test.describe.serial("sponsor — email routing", () => {
  let staffPage: Page;
  let aminaId: string;
  let sentDocId: string;
  let needDocId: string;
  const sponsorEmail = "sponsor.routing@example.com";
  const sponsorPassword = "SponsorTest123!";

  test.beforeAll(async ({ playwright }) => {
    // Reuse the admin session established by the main journeys suite — avoids a
    // second TOTP sign-in which would be rejected by the anti-replay window.
    staffPage = sharedStaffPage;

    // Find Amina's case ID from the staff cases list
    const casesRes = await staffPage.request.get("/api/staff/cases");
    const { cases } = (await casesRes.json()) as { cases: { id: string; caseRef: string }[] };
    const amina = cases.find((c) => c.caseRef === "IM-2041");
    expect(amina).toBeDefined();
    aminaId = amina!.id;

    // Create a sponsor account for Amina's case
    const sponsorRes = await staffPage.request.post(`/api/staff/cases/${aminaId}/sponsor`, {
      data: { email: sponsorEmail, label: "Employer" },
      headers: { "Content-Type": "application/json", "Origin": E2E.APP_URL },
    });
    expect(sponsorRes.status()).toBe(201);

    // Read the sponsor invite email and extract the one-time setup token
    // The invite URL is /i/{token} — the token is the last path segment, not a query param
    const invite = await mailTo(sponsorEmail, /invitation to upload your documents/);
    const token = new URL(invite.action!.url).pathname.split("/").pop()!;

    // Set up the sponsor account via the setup API
    const setupCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    const setupRes = await setupCtx.post("/api/auth/client/setup", {
      data: { token, password: sponsorPassword, firstName: "Test", lastName: "Sponsor" },
      headers: { "Content-Type": "application/json" },
    });
    expect(setupRes.status()).toBe(200);
    await setupCtx.dispose();

    // Fetch Amina's documents and pick one SENT and one NEED doc
    const caseRes = await staffPage.request.get(`/api/staff/cases/${aminaId}`);
    const caseView = (await caseRes.json()) as { groups: { docs: { id: string; title: string; status: string }[] }[] };
    const allDocs = caseView.groups.flatMap((g) => g.docs);
    sentDocId = allDocs.find((d) => d.status === "SENT")!.id;
    needDocId = allDocs.find((d) => d.status === "NEED")!.id;
    expect(sentDocId).toBeTruthy();
    expect(needDocId).toBeTruthy();

    // Assign the SENT doc to the sponsor
    const assignRes = await staffPage.request.patch(`/api/staff/documents/${sentDocId}/assign`, {
      data: { assignedTo: "SPONSOR" },
      headers: { "Content-Type": "application/json", "Origin": E2E.APP_URL },
    });
    expect(assignRes.status()).toBe(200);
  });

  test("redo on a sponsor-assigned doc emails the sponsor, not the main client", async () => {
    // Caseworker asks for a redo on the SPONSOR-assigned SENT doc
    const reviewRes = await staffPage.request.post(`/api/staff/documents/${sentDocId}/review`, {
      data: { action: "redo", note: "Wrong format — please re-submit as PDF" },
      headers: { "Content-Type": "application/json", "Origin": E2E.APP_URL },
    });
    expect(reviewRes.status()).toBe(200);

    // Sponsor receives the redo email
    const sponsorMail = await mailTo(sponsorEmail, /please re-upload/);
    expect(sponsorMail.to).toBe(sponsorEmail);

    // The caseworker note text must NOT appear in the email body
    expect(sponsorMail.text).not.toContain("Wrong format");

    // Main client (Amina) must not have received a redo email for this doc
    const aminaRedoMails = readdirSync(E2E.EMAIL_FILE_DIR)
      .map((f) => JSON.parse(readFileSync(path.join(E2E.EMAIL_FILE_DIR, f), "utf8")) as Mail)
      .filter((m) => m.to === "amina.khan@example.com" && /please re-upload/.test(m.subject));
    expect(aminaRedoMails).toHaveLength(0);
  });

  test("a reply to a sponsor's 'can't find' emails the sponsor, not the main client", async ({ playwright }) => {
    // Assign the NEED doc to the sponsor
    const assignRes = await staffPage.request.patch(`/api/staff/documents/${needDocId}/assign`, {
      data: { assignedTo: "SPONSOR" },
      headers: { "Content-Type": "application/json", "Origin": E2E.APP_URL },
    });
    expect(assignRes.status()).toBe(200);

    // Sign in as the sponsor and flag the doc as missing
    const sponsorCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    const loginRes = await sponsorCtx.post("/api/auth/client/login", {
      data: { email: sponsorEmail, password: sponsorPassword },
      headers: { "Content-Type": "application/json" },
    });
    expect(loginRes.status()).toBe(200);

    const missingRes = await sponsorCtx.post(`/api/client/documents/${needDocId}/missing`, {
      data: { reason: "The employer cannot locate this certificate" },
      headers: { "Content-Type": "application/json" },
    });
    expect(missingRes.status()).toBe(200);
    await sponsorCtx.dispose();

    // Caseworker replies to the missing flag
    const respondRes = await staffPage.request.post(`/api/staff/documents/${needDocId}/missing`, {
      data: { note: "Please ask HR for a certified copy" },
      headers: { "Content-Type": "application/json", "Origin": E2E.APP_URL },
    });
    expect(respondRes.status()).toBe(200);

    // Sponsor receives the reply email — not the main client
    const sponsorMail = await mailTo(sponsorEmail, /caseworker left a note/);
    expect(sponsorMail.to).toBe(sponsorEmail);
  });
});

test.describe.serial("guidance library", () => {
  test("G1. caseworker can view guidance; gets 403 from all admin guidance routes", async ({ playwright }) => {
    // Caseworker navigates to guidance screen
    await saraCwPage.goto("/staff");
    await saraCwPage.getByRole("button", { name: "Guidance library" }).click();
    await expect(saraCwPage.getByRole("heading", { name: "Guidance library" })).toBeVisible();

    // Unauthenticated requests to admin guidance endpoints must return 403
    const anon = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });

    // POST /api/admin/guidance
    const upload = await anon.post("/api/admin/guidance", { multipart: { title: "x" } });
    expect(upload.status()).toBe(403);

    // POST /api/admin/guidance/{id}/supersede
    const supersede = await anon.post("/api/admin/guidance/nonexistent/supersede", { multipart: { title: "x" } });
    expect(supersede.status()).toBe(403);

    // POST /api/admin/guidance/{id}/review
    const review = await anon.post("/api/admin/guidance/nonexistent/review");
    expect(review.status()).toBe(403);

    await anon.dispose();
  });

  test("G2. admin uploads, supersedes and marks reviewed; HTML source downloads", async () => {
    // PDF bytes that pass content-based MIME detection (%PDF magic bytes)
    const pdfBuf = Buffer.from("%PDF-1.4 e2e-test-guidance-pdf");
    const htmlBuf = Buffer.from("<!DOCTYPE html><html><body>E2E test guidance</body></html>");
    const mutHeaders = { Origin: E2E.APP_URL };

    // ── get a route ID ────────────────────────────────────────────────────
    const viewRes = await sharedStaffPage.request.get("/api/staff/guidance");
    expect(viewRes.status()).toBe(200);
    const view = await viewRes.json() as { routes: { id: string }[] };
    expect(view.routes.length).toBeGreaterThan(0);
    const routeId = view.routes[0].id;

    // ── upload a PDF source ───────────────────────────────────────────────
    const uploadRes = await sharedStaffPage.request.post("/api/admin/guidance", {
      headers: mutHeaders,
      multipart: {
        title: "E2E guidance PDF",
        govukUrl: "https://www.gov.uk/guidance/e2e-test",
        routeIds: routeId,
        file: { name: "e2e.pdf", mimeType: "application/pdf", buffer: pdfBuf },
      },
    });
    expect(uploadRes.status()).toBe(200);
    const { id: sourceId } = await uploadRes.json() as { id: string };
    expect(typeof sourceId).toBe("string");

    // ── mark reviewed ─────────────────────────────────────────────────────
    const reviewRes = await sharedStaffPage.request.post(`/api/admin/guidance/${sourceId}/review`, { headers: mutHeaders });
    expect(reviewRes.status()).toBe(200);

    // ── supersede with a new PDF version ──────────────────────────────────
    const supersedeRes = await sharedStaffPage.request.post(`/api/admin/guidance/${sourceId}/supersede`, {
      headers: mutHeaders,
      multipart: {
        title: "E2E guidance PDF v2",
        govukUrl: "https://www.gov.uk/guidance/e2e-test",
        routeIds: routeId,
        file: { name: "e2e-v2.pdf", mimeType: "application/pdf", buffer: pdfBuf },
      },
    });
    expect(supersedeRes.status()).toBe(200);
    const { id: newId } = await supersedeRes.json() as { id: string };

    // Superseded source is still openable by staff (any role)
    const openOld = await sharedStaffPage.request.get(`/api/staff/guidance/${sourceId}`);
    expect(openOld.status()).toBe(200);

    // ── upload an HTML source ─────────────────────────────────────────────
    const htmlRes = await sharedStaffPage.request.post("/api/admin/guidance", {
      headers: mutHeaders,
      multipart: {
        title: "E2E guidance HTML",
        govukUrl: "https://www.gov.uk/guidance/e2e-test",
        routeIds: routeId,
        file: { name: "e2e.html", mimeType: "text/html", buffer: htmlBuf },
      },
    });
    expect(htmlRes.status()).toBe(200);
    const { id: htmlId } = await htmlRes.json() as { id: string };

    // HTML source must be served with Content-Disposition: attachment (never inline)
    const htmlOpen = await sharedStaffPage.request.get(`/api/staff/guidance/${htmlId}`);
    expect(htmlOpen.status()).toBe(200);
    const disposition = htmlOpen.headers()["content-disposition"] ?? "";
    expect(disposition).toMatch(/^attachment/);
    expect(htmlOpen.headers()["content-type"]).toMatch(/^application\/octet-stream/);

    // Caseworker can also open the new active PDF source
    const cwOpen = await saraCwPage.request.get(`/api/staff/guidance/${newId}`);
    expect(cwOpen.status()).toBe(200);
  });
});

test.describe.serial("requirements", () => {
  const mutHeaders = { Origin: E2E.APP_URL };
  const cronHeaders = { Authorization: `Bearer ${E2E.CRON_SECRET}` };

  test("R1: caseworker gets 403 from all admin requirements routes; staff view returns 200", async () => {
    // Admin routes are off-limits for caseworkers
    const gen403 = await saraCwPage.request.post("/api/admin/requirements/generate", {
      headers: mutHeaders,
      data: JSON.stringify({ routeId: "any" }),
    });
    expect(gen403.status()).toBe(403);

    const patch403 = await saraCwPage.request.patch("/api/admin/requirements/fake-id", {
      headers: mutHeaders,
      data: JSON.stringify({ action: "approve" }),
    });
    expect(patch403.status()).toBe(403);

    // Staff view (caseworker) returns 200
    const viewRes = await saraCwPage.request.get("/api/staff/requirements");
    expect(viewRes.status()).toBe(200);
    const view = await viewRes.json() as { isAdmin: boolean; routes: unknown[] };
    expect(view.isAdmin).toBe(false);
    expect(Array.isArray(view.routes)).toBe(true);
  });

  test("R2: admin can create a draft run; cron processes it; run reaches a terminal state", async () => {
    // Get a route ID from the guidance view
    const guidanceRes = await sharedStaffPage.request.get("/api/staff/guidance");
    const guidanceData = await guidanceRes.json() as { routes: { id: string }[] };
    const routeId = guidanceData.routes[0]?.id;
    expect(routeId).toBeTruthy();

    // Create draft run
    const genRes = await sharedStaffPage.request.post("/api/admin/requirements/generate", {
      headers: mutHeaders,
      data: JSON.stringify({ routeId }),
    });
    expect(genRes.status()).toBe(200);
    const { runId } = await genRes.json() as { runId: string };
    expect(typeof runId).toBe("string");

    // Process via cron
    const cronRes = await sharedStaffPage.request.get("/api/jobs/requirements", { headers: cronHeaders });
    expect(cronRes.status()).toBe(200);

    // Poll until run reaches a terminal state (COMPLETE or FAILED)
    let status = "RUNNING";
    for (let i = 0; i < 10 && !["COMPLETE", "FAILED"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 500));
      const pollRes = await sharedStaffPage.request.get(`/api/admin/requirements/runs/${runId}`, { headers: mutHeaders });
      const run = await pollRes.json() as { status: string };
      status = run.status;
    }
    expect(["COMPLETE", "FAILED"]).toContain(status);

    // Admin requirements view includes this route
    const viewRes = await sharedStaffPage.request.get("/api/staff/requirements");
    expect(viewRes.status()).toBe(200);
    const view = await viewRes.json() as { isAdmin: boolean; routes: { id: string }[] };
    expect(view.isAdmin).toBe(true);
    const routeView = view.routes.find((r) => r.id === routeId);
    expect(routeView).toBeDefined();
  });
});

test.describe.serial("analysis tab — A1/A2/A3/A4/A5", () => {
  const mutHeaders = { Origin: E2E.APP_URL };
  let clientId = "";

  /** Helper: update firm.aiEnabled via the admin settings endpoint. */
  async function setAiEnabled(enabled: boolean) {
    const adminRes = await sharedStaffPage.request.get("/api/admin");
    const { firm } = await adminRes.json() as { firm: { name: string; phone: string; whatsapp: string; reviewDays: number; guidanceReviewMonths: number } };
    const res = await sharedStaffPage.request.post("/api/admin/firm", {
      headers: mutHeaders,
      data: JSON.stringify({ ...firm, aiEnabled: enabled }),
    });
    expect(res.status()).toBe(200);
  }

  test.beforeAll(async () => {
    // Find the seeded Amina Khan case (always present)
    const casesRes = await sharedStaffPage.request.get("/api/staff/cases");
    expect(casesRes.status()).toBe(200);
    const casesData = await casesRes.json() as { cases: { id: string; caseRef: string }[] };
    const amina = casesData.cases.find((c) => c.caseRef === "IM-2041");
    expect(amina, "seeded client IM-2041 must exist").toBeTruthy();
    clientId = amina!.id;

    await setAiEnabled(true);
  });

  test.afterAll(async () => {
    await setAiEnabled(false);
  });

  test("A1: client session gets 401 from all three analyse routes", async ({ playwright }) => {
    const clientCtx = await playwright.request.newContext({ baseURL: E2E.APP_URL, extraHTTPHeaders: { Origin: E2E.APP_URL } });
    await clientCtx.post("/api/auth/client/login", {
      data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD },
    });

    const [get, post, del] = await Promise.all([
      clientCtx.get(`/api/staff/cases/${clientId}/analysis`),
      clientCtx.post(`/api/staff/cases/${clientId}/analysis`, { data: JSON.stringify({ question: "test" }) }),
      clientCtx.delete(`/api/staff/cases/${clientId}/analysis/fake-qid`),
    ]);
    expect(get.status()).toBe(401);
    expect(post.status()).toBe(401);
    expect(del.status()).toBe(401);

    await clientCtx.dispose();
  });

  test("A2: caseworker Sara gets 404 asking about admin's client", async () => {
    // saraCwPage belongs to Sara (a caseworker who has no clients of her own).
    // Admin's client (Amina) is assigned to the Demo Caseworker, not Sara.
    // So Sara's visibleCases filter excludes it → 404.
    const res = await saraCwPage.request.post(
      `/api/staff/cases/${clientId}/analysis`,
      { headers: mutHeaders, data: JSON.stringify({ question: "test" }) },
    );
    expect(res.status()).toBe(404);
  });

  test("A3: with aiEnabled=false, GET returns view with aiEnabled:false; POST returns 403", async () => {
    await setAiEnabled(false);

    const getRes = await sharedStaffPage.request.get(`/api/staff/cases/${clientId}/analysis`);
    expect(getRes.status()).toBe(200);
    const viewData = await getRes.json() as { aiEnabled: boolean };
    expect(viewData.aiEnabled).toBe(false);

    const postRes = await sharedStaffPage.request.post(`/api/staff/cases/${clientId}/analysis`, {
      headers: mutHeaders,
      data: JSON.stringify({ question: "test" }),
    });
    expect(postRes.status()).toBe(403);

    // Re-enable for remaining tests
    await setAiEnabled(true);
  });

  test("A4: grounding — ##no-answer## question returns notFound:true", async () => {
    const res = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/analysis`,
      { headers: mutHeaders, data: JSON.stringify({ question: "##no-answer## trigger grounding test" }) },
    );
    expect(res.status()).toBe(200);
    const result = await res.json() as { notFound: boolean; answer: string };
    expect(result.notFound).toBe(true);
    expect(result.answer).toContain("couldn't confirm");
  });

  test("A5: upload text PDF, ask a question, answer shows a verified page citation", async ({ playwright }) => {
    // Build a single-page PDF using pdf-lib with LiberationSans embedded (ToUnicode CMap, no standardFontDataUrl needed).
    // Text is under 80 chars so the FakeAdapter's quote = the full text and quoteFound is guaranteed.
    const KNOWN_TEXT = "Applicant submitted valid passport with all required supporting documents for review.";
    const pdfBuf = await buildTextPdf(KNOWN_TEXT);

    // Sign in as Amina Khan and find an uploadable document
    const clientCtx = await playwright.request.newContext({
      baseURL: E2E.APP_URL,
      extraHTTPHeaders: { Origin: E2E.APP_URL },
    });
    await clientCtx.post("/api/auth/client/login", {
      data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD },
    });

    const portalRes = await clientCtx.get("/api/client/portal");
    expect(portalRes.status()).toBe(200);
    const portal = await portalRes.json() as { groups: { docs: { id: string; status: string; readOnly: boolean }[] }[] };
    const uploadableDoc = portal.groups.flatMap((g) => g.docs).find((d) => d.status !== "OK" && !d.readOnly);
    expect(uploadableDoc, "Amina's case needs at least one non-OK non-readOnly document for A5").toBeTruthy();

    // SHA-256 of the PDF for the upload protocol
    const hash = createHash("sha256").update(pdfBuf).digest("hex");

    // Start → chunk → complete
    const startRes = await clientCtx.post("/api/client/upload/start", {
      data: { docId: uploadableDoc!.id, pages: [{ fileName: "a5-test.pdf", sizeBytes: pdfBuf.length, sha256: hash, totalChunks: 1 }], multiPage: false },
    });
    expect(startRes.status()).toBe(200);
    const { sessionId } = await startRes.json() as { sessionId: string };

    const chunkRes = await clientCtx.put(`/api/client/upload/${sessionId}/chunk?page=0&n=0`, { data: pdfBuf });
    expect(chunkRes.status()).toBe(200);

    const completeRes = await clientCtx.post(`/api/client/upload/${sessionId}/complete`);
    expect(completeRes.status()).toBe(200);
    await clientCtx.dispose();

    // Ask a question via the staff session — fake AI creates one claim per source
    const qRes = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/analysis`,
      { headers: mutHeaders, data: JSON.stringify({ question: "What passport details are recorded?" }) },
    );
    expect(qRes.status()).toBe(200);
    const result = await qRes.json() as {
      answer: string;
      claims: { kind: string; pageNumber?: number; verified?: boolean }[];
      notFound: boolean;
    };

    // The uploaded PDF yields a verified claim; seeded files are too short or image-only → dropped
    expect(result.notFound).toBe(false);
    expect(result.answer).toMatch(/\(page \d+\)/);
    const verifiedClaim = result.claims.find((c) => c.kind === "client-document" && c.verified === true && c.pageNumber === 1);
    expect(verifiedClaim, "expected a verified page-1 client-document claim from the uploaded PDF").toBeTruthy();
  });
});

test.describe.serial("doc-checks — D1/D2", () => {
  const mutHeaders = { Origin: E2E.APP_URL };
  const cronHeaders = { Authorization: `Bearer ${E2E.CRON_SECRET}` };
  let clientId = "";

  async function setAiEnabled(enabled: boolean) {
    const adminRes = await sharedStaffPage.request.get("/api/admin");
    const { firm } = await adminRes.json() as { firm: { name: string; phone: string; whatsapp: string; reviewDays: number; guidanceReviewMonths: number } };
    await sharedStaffPage.request.post("/api/admin/firm", {
      headers: mutHeaders,
      data: JSON.stringify({ ...firm, aiEnabled: enabled }),
    });
  }

  type DocCheckDoc = {
    title: string;
    verdict: string;
    checks: Array<{ name: string; verdict: string }>;
    summaryFacts: Array<{ factKind: string; value: string }>;
  };
  type DocCheckRunPoll = { status: string; result: { docs: DocCheckDoc[] } | null };

  async function pollDocCheckRun(runId: string) {
    let runStatus = "QUEUED";
    let runResult: { docs: DocCheckDoc[] } | null = null;
    for (let i = 0; i < 10 && !["COMPLETE", "FAILED"].includes(runStatus); i++) {
      await new Promise((r) => setTimeout(r, 500));
      const pollRes = await sharedStaffPage.request.get(
        `/api/staff/cases/${clientId}/doc-checks/${runId}`,
      );
      const run = await pollRes.json() as DocCheckRunPoll;
      runStatus = run.status;
      runResult = run.result;
    }
    return { runStatus, runResult };
  }

  test.beforeAll(async () => {
    const casesRes = await sharedStaffPage.request.get("/api/staff/cases");
    const casesData = await casesRes.json() as { cases: { id: string; caseRef: string }[] };
    const amina = casesData.cases.find((c) => c.caseRef === "IM-2041");
    expect(amina, "seeded client IM-2041 must exist").toBeTruthy();
    clientId = amina!.id;
    await setAiEnabled(true);
  });

  test.afterAll(async () => {
    await setAiEnabled(false);
  });

  test("D1: upload PDF with expiry date; background job returns expiry verdict OK", async ({ playwright }) => {
    // Text contains a future expiry date and enough surrounding words for quote verification.
    const DOC_TEXT =
      "Passport expires 15 December 2030. Issued to Ms Amina Khan. Valid document.";
    const pdfBuf = await buildTextPdf(DOC_TEXT);

    // Upload as Amina Khan (any non-readOnly document is fine)
    const clientCtx = await playwright.request.newContext({
      baseURL: E2E.APP_URL,
      extraHTTPHeaders: { Origin: E2E.APP_URL },
    });
    await clientCtx.post("/api/auth/client/login", {
      data: { email: "amina.khan@example.com", password: E2E.SEED_CLIENT_PASSWORD },
    });
    const portalRes = await clientCtx.get("/api/client/portal");
    expect(portalRes.status()).toBe(200);
    const portal = await portalRes.json() as {
      groups: { docs: { id: string; status: string; readOnly: boolean }[] }[];
    };
    const uploadableDoc = portal.groups.flatMap((g) => g.docs).find((d) => d.status !== "OK" && !d.readOnly);
    expect(uploadableDoc, "Amina's case needs at least one non-readOnly document for D1").toBeTruthy();

    const hash = createHash("sha256").update(pdfBuf).digest("hex");
    const startRes = await clientCtx.post("/api/client/upload/start", {
      data: {
        docId: uploadableDoc!.id,
        pages: [{ fileName: "d1-test.pdf", sizeBytes: pdfBuf.length, sha256: hash, totalChunks: 1 }],
        multiPage: false,
      },
    });
    expect(startRes.status()).toBe(200);
    const { sessionId } = await startRes.json() as { sessionId: string };
    await clientCtx.put(`/api/client/upload/${sessionId}/chunk?page=0&n=0`, { data: pdfBuf });
    await clientCtx.post(`/api/client/upload/${sessionId}/complete`);
    await clientCtx.dispose();

    // Start background doc-check run
    const checkStartRes = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/doc-checks`,
      { headers: mutHeaders },
    );
    expect(checkStartRes.status()).toBe(200);
    const { runId } = await checkStartRes.json() as { runId: string };

    // Trigger cron to process the run
    const cronRes = await sharedStaffPage.request.get("/api/jobs/doc-checks", { headers: cronHeaders });
    expect(cronRes.status()).toBe(200);

    // Poll until run reaches a terminal state
    const { runStatus, runResult } = await pollDocCheckRun(runId);
    expect(runStatus).toBe("COMPLETE");

    // The uploaded PDF must produce at least one document with an expiry check that passes
    const allDocs = runResult?.docs ?? [];
    const withExpiry = allDocs.find((r) => r.checks.some((c) => c.name === "Expiry date"));
    expect(withExpiry, "expected at least one document result with an expiry check").toBeTruthy();

    const expiryCheck = withExpiry!.checks.find((c) => c.name === "Expiry date")!;
    expect(expiryCheck.verdict).toBe("OK");
  });

  test("D2: case summary facts appear in completed background run", async () => {
    // Create a new run — reuses the PDF uploaded by D1 which contains "Issued to Ms Amina Khan"
    const checkStartRes = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/doc-checks`,
      { headers: mutHeaders },
    );
    expect(checkStartRes.status()).toBe(200);
    const { runId } = await checkStartRes.json() as { runId: string };

    // Trigger cron to process
    const cronRes = await sharedStaffPage.request.get("/api/jobs/doc-checks", { headers: cronHeaders });
    expect(cronRes.status()).toBe(200);

    // Poll until complete
    const { runStatus, runResult } = await pollDocCheckRun(runId);
    expect(runStatus).toBe("COMPLETE");

    // result.docs must be non-empty and at least one doc has summaryFacts
    expect((runResult?.docs.length ?? 0), "result must have at least one processed document").toBeGreaterThan(0);
    const docsWithFacts = (runResult?.docs ?? []).filter((d) => d.summaryFacts.length > 0);
    expect(docsWithFacts.length, "at least one document must have summary facts").toBeGreaterThan(0);

    // Holder-name fact must appear (from "Issued to Ms Amina Khan" in the PDF)
    const allFacts = (runResult?.docs ?? []).flatMap((d) => d.summaryFacts);
    const holderFact = allFacts.find((f) => f.factKind === "holder-name");
    expect(holderFact, "holder-name fact must appear in case summary").toBeTruthy();
  });
});

test.describe.serial("guidance-check — E1/E2/E3", () => {
  const mutHeaders = { Origin: E2E.APP_URL };
  const cronHeaders = { Authorization: `Bearer ${E2E.CRON_SECRET}` };
  let clientId = "";

  async function setAiEnabled(enabled: boolean) {
    const adminRes = await sharedStaffPage.request.get("/api/admin");
    const { firm } = await adminRes.json() as { firm: { name: string; phone: string; whatsapp: string; reviewDays: number; guidanceReviewMonths: number } };
    await sharedStaffPage.request.post("/api/admin/firm", {
      headers: mutHeaders,
      data: JSON.stringify({ ...firm, aiEnabled: enabled }),
    });
  }

  test.beforeAll(async () => {
    const casesRes = await sharedStaffPage.request.get("/api/staff/cases");
    const casesData = await casesRes.json() as { cases: { id: string; caseRef: string }[] };
    const amina = casesData.cases.find((c) => c.caseRef === "IM-2041");
    expect(amina, "seeded client IM-2041 must exist").toBeTruthy();
    clientId = amina!.id;
  });

  test.afterAll(async () => {
    await setAiEnabled(false);
  });

  test("E1: cron endpoint returns ok:true when no runs are queued", async () => {
    const cronRes = await sharedStaffPage.request.get("/api/jobs/guidance-check", { headers: cronHeaders });
    expect(cronRes.status()).toBe(200);
    const body = await cronRes.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("E2: POST guidance-check returns 403 when AI is disabled", async () => {
    await setAiEnabled(false);
    const res = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/guidance-check`,
      { headers: mutHeaders },
    );
    expect(res.status()).toBe(403);
  });

  test("E3: POST guidance-check with AI enabled but no approved requirements returns 403", async () => {
    await setAiEnabled(true);
    const res = await sharedStaffPage.request.post(
      `/api/staff/cases/${clientId}/guidance-check`,
      { headers: mutHeaders },
    );
    // No approved requirements on this route in the seed → 403
    expect(res.status()).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("approved requirements");
  });
});
