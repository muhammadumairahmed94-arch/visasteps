/**
 * Creates the firm's first admin, or resets an existing admin's password and two-step sign-in.
 * For the live portal (Phase 5) — the demo seed must never run there.   npm run admin:create
 */
import bcrypt from "bcryptjs";
import { db } from "../lib/db";
import { askHidden, askUntil } from "./prompt.mjs";

const firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
if (!firm) {
  console.error("No firm in the database yet.");
  process.exit(1);
}
console.log(`\nAdmin account for ${firm.name}. Ctrl+C stops without saving.\n`);
const email = (await askUntil("Admin email: ", (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Type an email address.")).toLowerCase();
const existing = await db.user.findUnique({ where: { email } });
const name = existing?.name ?? (await askUntil("Full name: ", (v: string) => v.length >= 2, "Type a name."));
let password = "";
while (password.length < 12) {
  password = await askHidden("Password, at least 12 characters (hidden): ");
  if (password.length < 12) console.log("  Too short.\n");
}
const passwordHash = await bcrypt.hash(password, 12);
const reset = { passwordHash, role: "ADMIN" as const, disabledAt: null, failedLogins: 0, lockedUntil: null, totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] };
if (existing) {
  await db.user.update({ where: { id: existing.id }, data: reset });
  await db.session.deleteMany({ where: { userId: existing.id } });
  console.log(`\nUpdated ${email}: admin, new password, two-step sign-in will be set up at next sign-in.`);
} else {
  await db.user.create({ data: { ...reset, firmId: firm.id, name, email } });
  console.log(`\nCreated admin ${email}. Sign in at /staff and set up two-step sign-in.`);
}
await db.$disconnect();
