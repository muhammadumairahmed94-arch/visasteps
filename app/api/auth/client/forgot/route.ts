import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendResetLink, sendSetupLink } from "@/lib/accounts";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

/** Emails a reset link (or the setup link again, if the account was never created). Same reply either way. */
export const POST = handler(async (req) => {
  const { email } = await body<{ email: string }>(req);
  const address = String(email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(address)) return fail("Please enter your email address.");
  await limit("forgotIp");
  await limit("forgotEmail", address);
  const client = await db.client.findUnique({ where: { email: address }, include: { firm: true } });
  if (client && !client.closedAt) {
    await (client.accountCreatedAt ? sendResetLink(client, client.firm) : sendSetupLink(client, client.firm));
    await audit({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "client.reset.request" });
  }
  return json({ ok: true });
});
