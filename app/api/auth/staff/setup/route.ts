import { db } from "@/lib/db";
import { findStaffLink, hashPassword } from "@/lib/accounts";
import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

/** Staff "set your password" link. {token} → who it is for; {token, password} → set it and go on to 2FA. */
export const POST = handler(async (req) => {
  await limit("link");
  const { token, password } = await body<{ token: string; password: string }>(req);
  const link = await findStaffLink(token);
  if (!link) return fail("This link has expired or was already used. Ask an admin to send a new one.", 410);
  if (password === undefined) return json({ name: link.user.name, email: link.user.email, firm: link.user.firm.name });

  const pw = String(password);
  if (pw.length < 12) return fail("Please use at least 12 characters.");
  if (pw.length > 200) return fail("That password is too long.");
  await db.user.update({ where: { id: link.user.id }, data: { passwordHash: await hashPassword(pw), failedLogins: 0, lockedUntil: null } });
  await db.invite.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  await db.session.deleteMany({ where: { userId: link.user.id } }); // a new password signs out old sessions
  await startSession("staff", { userId: link.user.id }, "MFA");
  await audit({ firmId: link.user.firmId, actorType: "USER", actorId: link.user.id, action: "staff.password.set" });
  return json({ next: link.user.totpEnabledAt ? "code" : "enrol" });
});
