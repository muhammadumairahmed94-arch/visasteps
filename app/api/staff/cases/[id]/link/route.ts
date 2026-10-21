import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createLink } from "@/lib/accounts";
import { fail, handler, json } from "@/lib/http";

/**
 * A fresh link for the caseworker to send by WhatsApp or text, when email is not available.
 * No account yet → "create your account" link (7 days). Account exists → password reset link (1 hour).
 * Either way, older unused links of that kind stop working.
 */
export const POST = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const where = me.role === "ADMIN" ? { firmId: me.firmId } : { firmId: me.firmId, caseworkerId: me.id };
  const client = await db.client.findFirst({ where: { id: (await ctx.params).id, ...where }, include: { firm: true } });
  if (!client) return fail("Not found", 404);

  const reset = !!client.accountCreatedAt;
  const url = await createLink(client.id, reset ? "RESET" : "SETUP");
  const message = reset
    ? `${client.firm.name}: use this link to choose a new password for the client portal. It works once, for 1 hour.\n${url}`
    : `${client.firm.name} has invited you to its secure client portal to upload your visa documents. Create your account here (valid 7 days):\n${url}`;
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: reset ? "client.reset.link" : "client.invite.link", targetId: client.id });
  return json({ url, message, kind: reset ? "reset" : "invite", mobile: client.mobile });
});
