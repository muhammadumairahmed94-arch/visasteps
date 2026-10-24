import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { redeemOtpCode } from "@/lib/accounts";

export const POST = handler(async (req) => {
  await limit("otpVerify"); // per IP
  const { email, code } = await body<{ email: string; code: string }>(req);
  if (!email || !code) return fail("Please enter your email and the code.");

  const r = await redeemOtpCode(String(email), String(code));
  if (!r.ok) {
    if (r.client) await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.otp.failed" });
    return fail(r.message, 401);
  }

  await startSession("client", { clientId: r.client.id });
  await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.otp.verify" });
  return json({ ok: true });
});
