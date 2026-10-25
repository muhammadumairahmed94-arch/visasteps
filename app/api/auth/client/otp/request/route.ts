import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { hit, limit } from "@/lib/ratelimit";
import { createSignInCode, sendOtpEmail } from "@/lib/accounts";

// Same wording whether or not the email belongs to an account
const OTP_MSG = "If that email belongs to an account, a sign-in code has been sent. It is valid for 10 minutes.";

export const POST = handler(async (req) => {
  await limit("otpRequest"); // per IP
  const { email } = await body<{ email: string }>(req);
  if (!email || typeof email !== "string") return fail("Please enter your email address.");
  const normEmail = email.trim().toLowerCase();

  // Per-email limit: silently gate (not a 429) so the error reveals nothing about whether the email exists
  const emailAllowed = await hit("otpRequestEmail", normEmail);

  const client = await db.client.findUnique({ where: { email: normEmail }, include: { firm: true } });

  const locked = client?.lockedUntil && client.lockedUntil > new Date();
  if (client && !client.closedAt && !locked && emailAllowed) {
    // Create the code now (synchronous — must exist before the client tries to verify).
    const code = await createSignInCode(client.id);
    // Email delivery and audit run after the response so the route takes the same time
    // regardless of whether the email address belongs to an account.
    after(async () => {
      await sendOtpEmail(code, client, client.firm);
      await audit({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "client.otp.request" });
    });
  }

  return json({ message: OTP_MSG });
});
