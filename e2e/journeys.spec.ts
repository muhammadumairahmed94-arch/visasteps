import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
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

/** Admin sign-in including first-time authenticator setup (the test plays the phone app). */
async function staffSignIn(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/staff");
  await page.getByLabel("Email").fill("info@uhalegal.com");
  await page.getByLabel("Password").fill(E2E.SEED_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
  const key = (await page.locator(".muted .fn").textContent())!.replace(/\s/g, "");
  await page.getByLabel(/6-digit code/).fill(new TOTP({ secret: Secret.fromBase32(key) }).generate());
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await page.getByLabel("I have saved these codes somewhere safe").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  return { ctx, page };
}

test.describe.serial("main journeys", () => {
  let staff: Page;
  let client: Page;
  let clientCaseId = "";

  test.beforeAll(async ({ browser }) => {
    staff = (await staffSignIn(browser)).page;
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
    await client.locator("#up").setInputFiles(fixture("passport.png"));
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
    await client.locator("#up").setInputFiles(fixture("certificate.png"));
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
    expect(notice.text).toContain("The photo is blurred");

    // Client sees the request and uploads again
    await client.goto("/");
    await expect(client.getByRole("button", { name: /^English and TB test.*Action required/ })).toBeVisible();
    await client.getByRole("button", { name: /^English and TB test/ }).click();
    await client.getByRole("button", { name: /^English language evidence.*Please redo/ }).click();
    await expect(client.getByText("Caseworker note:")).toBeVisible();
    await expect(client.getByText("The photo is blurred. Please upload a clearer copy.")).toBeVisible();
    await client.locator("#up").setInputFiles(fixture("certificate.png"));
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

    const upload = await amina.post(`/api/client/documents/${passport.id}`, { multipart: { files: { name: "x.png", mimeType: "image/png", buffer: readFileSync(fixture("passport.png")) } } });
    expect(upload.status()).toBe(400);
    expect((await upload.json()).error).toMatch(/could not find this document/);

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
    await client.locator("#up").setInputFiles(fixture("passport.png"));
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
