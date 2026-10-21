import { beforeAll, describe, expect, it, vi } from "vitest";
import { Secret, TOTP } from "otpauth";
import nodemailer from "nodemailer";
import type { User } from "@prisma/client";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
});

// lib/totp imports the database client; checking codes never touches it
vi.mock("../lib/db", () => ({ db: {} }));

const user = (over: Partial<User>): User =>
  ({ id: "u1", email: "cw@example.com", totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], ...over }) as User;

describe("encryption", () => {
  it("round-trips and refuses tampered data", async () => {
    const { encrypt, decrypt } = await import("../lib/crypto");
    const box = encrypt("JBSWY3DPEHPK3PXP", "totp");
    expect(decrypt(box, "totp")).toBe("JBSWY3DPEHPK3PXP");
    const [iv, tag, data] = box.split(".");
    expect(() => decrypt([iv, tag, data.slice(0, -2) + (data.endsWith("AA") ? "BB" : "AA")].join("."), "totp")).toThrow();
  });
});

describe("authenticator codes", () => {
  it("accepts the current code once, rejects replays and wrong codes", async () => {
    const { encrypt } = await import("../lib/crypto");
    const { checkCode } = await import("../lib/totp");
    const secret = new Secret({ size: 20 }).base32;
    const u = user({ totpSecret: encrypt(secret, "totp") });
    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate();

    const step = checkCode(u, code);
    expect(step).not.toBeNull();
    expect(checkCode({ ...u, totpLastStep: step }, code)).toBeNull(); // same code again
    expect(checkCode(u, code === "000000" ? "111111" : "000000")).toBeNull();
    expect(checkCode(u, "12345")).toBeNull();
  });

  it("recovery codes work once each", async () => {
    const { newRecoveryCodes, useRecoveryCode } = await import("../lib/totp");
    const { codes, hashes } = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    const remaining = useRecoveryCode(user({ recoveryCodes: hashes }), codes[3].toUpperCase())!;
    expect(remaining).toHaveLength(7);
    expect(useRecoveryCode(user({ recoveryCodes: remaining }), codes[3])).toBeNull();
  });
});

describe("email", () => {
  it("escapes content and includes the link as text and button", async () => {
    const { renderEmail } = await import("../lib/adapters/email");
    const { html, text } = renderEmail({ to: "a@b.c", subject: "s", brand: "UHA Legal", text: "Hi <script>x</script>", action: { label: "Create account", url: "https://x.test/i/abc" } });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://x.test/i/abc"');
    expect(text).toContain("Create account: https://x.test/i/abc");
  });

  it("SMTP adapter hands a complete message to the mail server", async () => {
    const { SmtpEmail } = await import("../lib/adapters/email");
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent = vi.spyOn(transport, "sendMail");
    await new SmtpEmail(transport, "UHA Legal <portal@uhalegal.com>", "info@uhalegal.com").send({ to: "client@uhalegal.com", subject: "Hello", text: "Body" });
    const msg = sent.mock.calls[0][0];
    expect(msg).toMatchObject({ from: "UHA Legal <portal@uhalegal.com>", replyTo: "info@uhalegal.com", to: "client@uhalegal.com", subject: "Hello" });
    expect(String(msg.html)).toContain("Body");
  });
});

describe("test addresses", () => {
  it("are never sent real email", async () => {
    const { isTestAddress } = await import("../lib/adapters/email");
    for (const a of ["amina.khan@example.com", "caseworker@uhalegal.example", "x@foo.test", "y@bar.invalid"]) expect(isTestAddress(a)).toBe(true);
    for (const a of ["info@uhalegal.com", "client@gmail.com", "someone@example.co.uk"]) expect(isTestAddress(a)).toBe(false);
  });
});

describe("reminder hours", () => {
  it("only 9am–7pm UK time", async () => {
    const { inSendingHours } = await import("../lib/reminders");
    expect(inSendingHours(new Date("2026-10-19T08:30:00Z"))).toBe(true); // 09:30 BST
    expect(inSendingHours(new Date("2026-10-19T07:59:00Z"))).toBe(false); // 08:59 BST
    expect(inSendingHours(new Date("2026-10-19T18:00:00Z"))).toBe(false); // 19:00 BST
    expect(inSendingHours(new Date("2026-12-07T18:30:00Z"))).toBe(true); // 18:30 GMT (winter)
  });
});

describe("Brevo email (HTTPS)", () => {
  it("posts sender, recipient, subject and both bodies with the API key", async () => {
    const { BrevoEmail } = await import("../lib/adapters/email");
    const calls: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}", { status: 201 }))) as unknown as typeof fetch;
    await new BrevoEmail("key-123", "UHA Legal <portal@uhalegal.com>", "info@uhalegal.com", http).send({ to: "client@uhalegal.com", subject: "Hi", text: "Body", action: { label: "Open", url: "https://portal.uhalegal.com/" } });
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(new Headers(calls[0].init.headers).get("api-key")).toBe("key-123");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ sender: { name: "UHA Legal", email: "portal@uhalegal.com" }, to: [{ email: "client@uhalegal.com" }], replyTo: { email: "info@uhalegal.com" }, subject: "Hi" });
    expect(body.textContent).toContain("Open: https://portal.uhalegal.com/");
    expect(body.htmlContent).toContain("Body");
  });

  it("reports Brevo's error so the caseworker sees a warning", async () => {
    const { BrevoEmail } = await import("../lib/adapters/email");
    const http = (async () => new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 })) as unknown as typeof fetch;
    await expect(new BrevoEmail("bad", "portal@uhalegal.com", undefined, http).send({ to: "a@uhalegal.com", subject: "s", text: "t" })).rejects.toThrow(/unauthorized/);
  });
});

describe("website mail relay", () => {
  it("signs each message so the website can check it came from the portal", async () => {
    const { RelayEmail } = await import("../lib/adapters/email");
    const { createHmac } = await import("node:crypto");
    let seen: { headers: Headers; body: string } | undefined;
    const http = (async (_url: string, init: RequestInit) => ((seen = { headers: new Headers(init.headers), body: String(init.body) }), new Response('{"ok":true}'))) as unknown as typeof fetch;
    const secret = "s".repeat(40);
    await new RelayEmail("https://www.uhalegal.com/api/portal-mail", secret, "info@uhalegal.com", http).send({ to: "client@uhalegal.com", subject: "Hi", text: "Body", brand: "UHA Legal" });
    const ts = seen!.headers.get("x-relay-timestamp")!;
    expect(seen!.headers.get("x-relay-signature")).toBe(createHmac("sha256", secret).update(`${ts}.${seen!.body}`).digest("hex"));
    expect(JSON.parse(seen!.body)).toMatchObject({ to: "client@uhalegal.com", subject: "Hi", replyTo: "info@uhalegal.com", fromName: "UHA Legal" });
  });

  it("surfaces a refusal so caseworkers see a warning", async () => {
    const { RelayEmail } = await import("../lib/adapters/email");
    const http = (async () => new Response('{"error":"Forbidden"}', { status: 403 })) as unknown as typeof fetch;
    await expect(new RelayEmail("https://x.test/relay", "s".repeat(40), undefined, http).send({ to: "a@uhalegal.com", subject: "s", text: "t" })).rejects.toThrow(/403 Forbidden/);
  });
});
