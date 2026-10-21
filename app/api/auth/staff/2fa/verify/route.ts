import { db } from "@/lib/db";
import { endSession, pendingStaff, startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { LOCKED, clearFailures, isLocked, recordFailure } from "@/lib/staffauth";
import { checkCode, newRecoveryCodes, useRecoveryCode } from "@/lib/totp";

/** Step 2 of 2: authenticator code (or a recovery code). Completes setup on first use. */
export const POST = handler(async (req) => {
  await limit("staffLogin");
  const user = await pendingStaff();
  if (!user) return fail("Please sign in again.", 401);
  if (isLocked(user)) {
    await endSession("staff");
    return fail(LOCKED, 429);
  }
  const { code } = await body<{ code: string }>(req);
  const input = String(code ?? "").trim();
  const digits = input.replace(/\s/g, "");

  const wrong = async () => {
    await audit({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "staff.2fa.failed" });
    if (await recordFailure(user)) {
      await endSession("staff");
      return fail(LOCKED, 429);
    }
    return fail("That code is not right. Check the app and try again.", 400);
  };

  // First time: confirm the app is set up, then hand out recovery codes once
  if (!user.totpEnabledAt) {
    const step = checkCode(user, digits);
    if (step === null) return wrong();
    const { codes, hashes } = newRecoveryCodes();
    await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
    await clearFailures(user);
    await startSession("staff", { userId: user.id });
    await audit({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "staff.2fa.enrol" });
    return json({ recoveryCodes: codes });
  }

  if (/^\d{6}$/.test(digits)) {
    const step = checkCode(user, digits);
    if (step === null) return wrong();
    await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
  } else {
    const remaining = useRecoveryCode(user, input);
    if (!remaining) return wrong();
    await db.user.update({ where: { id: user.id }, data: { recoveryCodes: remaining } });
    await audit({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "staff.2fa.recovery" });
  }
  await clearFailures(user);
  await startSession("staff", { userId: user.id });
  await audit({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "staff.signin" });
  return json({ ok: true });
});
