import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { sendResetLink, sendSetupLink } from "@/lib/accounts";
import { audit } from "@/lib/audit";

export const POST = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const where = me.role === "ADMIN" ? { firmId: me.firmId } : { firmId: me.firmId, caseworkerId: me.id };
  const client = await db.client.findFirst({ where: { id: (await ctx.params).id, ...where }, include: { firm: true } });
  if (!client) return fail("Not found", 404);
  // Before the account exists: the "create your account" link again. After: a password reset link.
  const reset = !!client.accountCreatedAt;
  const sent = await (reset ? sendResetLink(client, client.firm) : sendSetupLink(client, client.firm));
  if (!sent) return fail("The email could not be sent. Please check the email settings and try again.", 502);
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: reset ? "client.reset.send" : "client.invite", targetId: client.id });
  return json({ message: reset ? "Password reset link sent by email" : "Invite sent again by email" });
});
