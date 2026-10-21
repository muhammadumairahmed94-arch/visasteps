import { db } from "@/lib/db";
import { pendingStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { beginEnrolment } from "@/lib/totp";

/** First sign-in only: the QR code to scan into an authenticator app. */
export const POST = handler(async () => {
  const user = await pendingStaff();
  if (!user) return fail("Please sign in again.", 401);
  if (user.totpEnabledAt) return fail("Two-step sign-in is already set up.");
  const firm = await db.firm.findUniqueOrThrow({ where: { id: user.firmId } });
  return json(await beginEnrolment(user, firm.name));
});
