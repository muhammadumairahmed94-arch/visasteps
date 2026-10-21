import nodemailer, { type Transporter } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain paragraphs, separated by blank lines. */
  text: string;
  /** Firm name shown in the email header. */
  brand?: string;
  /** Optional main button, e.g. "Create account". Also added to the plain-text version. */
  action?: { label: string; url: string };
}

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Branded HTML (UHA charcoal header, teal button) plus a plain-text twin. Inline styles only, for email clients. */
export function renderEmail(msg: EmailMessage) {
  const firmName = msg.brand ?? "UHA Legal";
  const paras = msg.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const text = [...paras, ...(msg.action ? [`${msg.action.label}: ${msg.action.url}`] : [])].join("\n\n");
  const button = msg.action
    ? `<tr><td style="padding:8px 32px 24px"><a href="${esc(msg.action.url)}" style="display:inline-block;background:#2e7d80;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;font-size:16px">${esc(msg.action.label)}</a></td></tr>
       <tr><td style="padding:0 32px 24px;font-size:13px;color:#5f6670">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#00292a">${esc(msg.action.url)}</span></td></tr>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#fafaf8;font-family:Inter,Helvetica,Arial,sans-serif;color:#262626">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4df">
<tr><td style="background:#262626;padding:18px 32px;color:#ffffff;font-family:Georgia,serif;font-size:20px;letter-spacing:.02em">${esc(firmName)}</td></tr>
${paras.map((p) => `<tr><td style="padding:20px 32px 0;font-size:16px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</td></tr>`).join("")}
<tr><td style="height:16px"></td></tr>${button}
<tr><td style="border-top:1px solid #e4e4df;padding:16px 32px;font-size:12px;color:#5f6670">${esc(firmName)} · Client portal · This is an automated message.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/** Local development: prints the email in the terminal. */
class FakeEmail implements EmailAdapter {
  async send(msg: EmailMessage) {
    const { text } = renderEmail(msg);
    console.log(`\n┌─ FAKE EMAIL to ${msg.to}\n│ Subject: ${msg.subject}\n│ ${text.replace(/\n/g, "\n│ ")}\n└${"─".repeat(56)}\n`);
  }
}

/** Automated tests: each email is written as a JSON file the tests can read (EMAIL_FILE_DIR). */
class FileEmail implements EmailAdapter {
  async send(msg: EmailMessage) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const dir = process.env.EMAIL_FILE_DIR ?? "./e2e-mail";
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`, JSON.stringify(msg));
  }
}

/** Real email over SMTP — Hostinger today (same as uhalegal.com), any SMTP service later. */
export class SmtpEmail implements EmailAdapter {
  constructor(
    private transport: Transporter,
    private from: string,
    private replyTo?: string,
  ) {}

  async send(msg: EmailMessage) {
    if (isTestAddress(msg.to)) {
      console.log(`Email to ${msg.to} not sent: reserved test address (“${msg.subject}”)`);
      return;
    }
    const { text, html } = renderEmail(msg);
    await this.transport.sendMail({ from: this.from, replyTo: this.replyTo, to: msg.to, subject: msg.subject, text, html });
  }
}

/**
 * Brevo (EU email service) over HTTPS — for servers where outgoing mail ports are blocked (DigitalOcean).
 * EMAIL_PROVIDER="brevo", BREVO_API_KEY, EMAIL_FROM ("UHA Legal <portal@uhalegal.com>", on a domain verified in Brevo).
 */
export class BrevoEmail implements EmailAdapter {
  constructor(
    private apiKey: string,
    private from: string,
    private replyTo?: string,
    private http: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage) {
    if (isTestAddress(msg.to)) {
      console.log(`Email to ${msg.to} not sent: reserved test address (“${msg.subject}”)`);
      return;
    }
    const { text, html } = renderEmail(msg);
    const m = this.from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    const sender = m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { email: this.from.trim() };
    const res = await this.http("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender,
        to: [{ email: msg.to }],
        ...(this.replyTo ? { replyTo: { email: this.replyTo } } : {}),
        subject: msg.subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      throw new Error(`Brevo refused the email: ${res.status} ${body.code ?? ""} ${body.message ?? ""}`.trim());
    }
  }
}

/**
 * Mail relay on the firm's website (www.uhalegal.com/api/portal-mail), which sends through Hostinger.
 * For servers whose outgoing mail ports are blocked. Each request is signed with EMAIL_RELAY_SECRET (HMAC-SHA256
 * over "<timestamp>.<body>"), so only the portal can use the relay.
 * EMAIL_PROVIDER="relay", EMAIL_RELAY_URL, EMAIL_RELAY_SECRET.
 */
export class RelayEmail implements EmailAdapter {
  constructor(
    private url: string,
    private secret: string,
    private replyTo?: string,
    private http: typeof fetch = fetch,
  ) {}

  async send(msg: EmailMessage) {
    if (isTestAddress(msg.to)) {
      console.log(`Email to ${msg.to} not sent: reserved test address (“${msg.subject}”)`);
      return;
    }
    const { text, html } = renderEmail(msg);
    const body = JSON.stringify({ to: msg.to, subject: msg.subject, text, html, replyTo: this.replyTo, fromName: msg.brand ?? "UHA Legal" });
    const ts = String(Date.now());
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", this.secret).update(`${ts}.${body}`).digest("hex");
    const res = await this.http(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relay-Timestamp": ts, "X-Relay-Signature": sig },
      body,
      redirect: "error", // a redirect would drop the POST body
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`Mail relay refused the email: ${res.status} ${detail.error ?? ""}`.trim());
    }
  }
}

/** Reserved test domains (RFC 2606/6761) — demo and test data use them; real mail to them would only bounce. */
export const isTestAddress = (to: string) => /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i.test(to.trim());

let smtp: SmtpEmail | undefined;

function smtpFromEnv(): SmtpEmail {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_REPLY_TO } = process.env;
  if (!SMTP_USER || !SMTP_PASS || !EMAIL_FROM) throw new Error("EMAIL_PROVIDER=smtp needs SMTP_USER, SMTP_PASS and EMAIL_FROM");
  const port = Number(SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST || "smtp.hostinger.com",
    port,
    secure: port === 465, // 465 = TLS from the start; 587 = STARTTLS
    requireTLS: port !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Fail fast when the mail server is unreachable (e.g. ports blocked by the host) instead of hanging ~2 minutes
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
  });
  return new SmtpEmail(transport, EMAIL_FROM, EMAIL_REPLY_TO || undefined);
}

export function email(): EmailAdapter {
  const provider = process.env.EMAIL_PROVIDER ?? "fake";
  if (provider === "fake") return new FakeEmail();
  if (provider === "file") return new FileEmail();
  if (provider === "smtp") return (smtp ??= smtpFromEnv());
  if (provider === "relay") {
    const { EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, EMAIL_REPLY_TO } = process.env;
    if (!EMAIL_RELAY_URL || !EMAIL_RELAY_SECRET || EMAIL_RELAY_SECRET.length < 32) throw new Error("EMAIL_PROVIDER=relay needs EMAIL_RELAY_URL and EMAIL_RELAY_SECRET (32+ characters)");
    return new RelayEmail(EMAIL_RELAY_URL, EMAIL_RELAY_SECRET, EMAIL_REPLY_TO || undefined);
  }
  if (provider === "brevo") {
    const { BREVO_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO } = process.env;
    if (!BREVO_API_KEY || !EMAIL_FROM) throw new Error("EMAIL_PROVIDER=brevo needs BREVO_API_KEY and EMAIL_FROM");
    return new BrevoEmail(BREVO_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO || undefined);
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}

/** Sends without throwing; returns false (and logs) if the mail server refused or was unreachable. */
export async function sendSafely(msg: EmailMessage): Promise<boolean> {
  try {
    await email().send(msg);
    return true;
  } catch (e) {
    console.error(`Email to ${msg.to} failed (“${msg.subject}”):`, e instanceof Error ? e.message : e);
    return false;
  }
}
