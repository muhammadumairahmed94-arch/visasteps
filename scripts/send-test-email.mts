/** Sends one test email through the configured adapter. Usage: npm run email:test [to@address] (default: the portal mailbox). */
import { email } from "../lib/adapters/email";

const to = process.argv[2] || process.env.SMTP_USER;
if (!to) throw new Error("No recipient: pass an address or set SMTP_USER");
await email().send({
  to,
  brand: "UHA Legal",
  subject: "UHA Legal client portal: test email",
  text: "This is a test from the client portal.\n\nIf this arrived, invitations and password reset emails will reach clients too.",
  action: { label: "Open client portal", url: `${process.env.APP_URL ?? "http://localhost:3000"}/` },
});
console.log(`Sent via ${process.env.EMAIL_PROVIDER} to ${to}`);
