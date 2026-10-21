import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { fail, handler, json, body } from "@/lib/http";
import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { limit } from "@/lib/ratelimit";
import { LOCKED, isLocked, recordFailure } from "@/lib/staffauth";

// Compared against when the email is unknown, so timing does not reveal which emails exist
const DUMMY = "$2b$12$7MLSQczEshzgUiOAFsCs.eY1ObwV/71CpG4KrSOFM69hpntfgZ63q";

/** Step 1 of 2: password. Success gives a short "MFA" session; the authenticator code completes sign-in. */
export const POST = handler(async (req) => {
  await limit("staffLogin");
  const { email, password } = await body<{ email: string; password: string }>(req);
  const user = email ? await db.user.findUnique({ where: { email: String(email).trim().toLowerCase() } }) : null;
  if (user && isLocked(user)) return fail(LOCKED, 429);
  const ok = await bcrypt.compare(String(password ?? ""), user?.passwordHash ?? DUMMY);
  if (!user || !ok || user.disabledAt) {
    if (user) {
      await recordFailure(user);
      await audit({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "staff.signin.failed" });
    }
    return fail("Email or password is wrong.", 401);
  }
  await startSession("staff", { userId: user.id }, "MFA");
  return json({ next: user.totpEnabledAt ? "code" : "enrol" });
});
