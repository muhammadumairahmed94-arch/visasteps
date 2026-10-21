#!/usr/bin/env node
/** Asks for the Hostinger mailbox, checks it with Hostinger, then saves it to .env. Run: npm run setup:email */
import nodemailer from "nodemailer";
import { askHidden, askUntil, saveEnv } from "./prompt.mjs";

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

console.log("\nPortal email setup — 3 questions. Press Ctrl+C at any time to stop without saving.\n");
const user = await askUntil("1/3  Mailbox ADDRESS (e.g. portal@uhalegal.com): ", isEmail, "That is not an email address. Type the mailbox address, like portal@uhalegal.com");
let pass = "";
while (!pass) pass = await askHidden("2/3  Mailbox PASSWORD (nothing shows as you type — that is normal): ");
const replyTo = await askUntil("3/3  Reply-to address (press Enter to skip, or e.g. info@uhalegal.com): ", (v) => v === "" || isEmail(v), "That is not an email address. Press Enter to skip.");

console.log("\nChecking with Hostinger…");
try {
  await nodemailer.createTransport({ host: "smtp.hostinger.com", port: 465, secure: true, auth: { user, pass } }).verify();
} catch (e) {
  console.error(`Hostinger did not accept these details: ${e.message}\nNothing was saved. Check the address and password, then run this again.`);
  process.exit(1);
}
saveEnv({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.hostinger.com", SMTP_PORT: "465", SMTP_USER: user, SMTP_PASS: pass, EMAIL_FROM: `UHA Legal <${user}>`, EMAIL_REPLY_TO: replyTo });
console.log(`Saved. The portal will now send real email from "UHA Legal <${user}>".`);
