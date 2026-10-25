import { z } from "zod";
import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { visibleCases } from "@/lib/documents";
import { audit } from "@/lib/audit";
import { limit } from "@/lib/ratelimit";
import { createSponsor } from "@/lib/cases";
import { sendSponsorInvite } from "@/lib/accounts";
import { cancelSponsor } from "@/lib/sponsor-ops";

const InviteBody = z.object({
  email: z.string().email("Please enter a valid email address."),
  label: z.string().trim().min(1, "Please enter a label (e.g. Partner).").max(60),
});

/** POST: invite (or re-invite) a sponsor. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const clientId = (await ctx.params).id;
  const parent = await db.client.findFirst({ where: { id: clientId, ...visibleCases(me) }, include: { firm: true } });
  if (!parent) return fail("Not found", 404);

  await limit("sponsorInvite", clientId);

  const v = InviteBody.safeParse(await body(req));
  if (!v.success) return fail(v.error.issues[0].message);

  const sponsor = await createSponsor(clientId, v.data, me);
  const sent = await sendSponsorInvite(sponsor, parent, parent.firm);
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "sponsor.invite", targetId: clientId });

  return json({ ok: true, sponsorId: sponsor.id, emailSent: sent }, 201);
});

/** DELETE: cancel the active sponsor. */
export const DELETE = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const clientId = (await ctx.params).id;
  const parent = await db.client.findFirst({ where: { id: clientId, ...visibleCases(me) } });
  if (!parent) return fail("Not found", 404);

  await cancelSponsor(clientId, me);
  return json({ ok: true });
});

/** PATCH: toggle visibleToClient. */
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const clientId = (await ctx.params).id;
  const parent = await db.client.findFirst({ where: { id: clientId, ...visibleCases(me) } });
  if (!parent) return fail("Not found", 404);

  const { visibleToClient } = await body<{ visibleToClient: boolean }>(req);
  if (typeof visibleToClient !== "boolean") return fail("visibleToClient must be a boolean.");

  const sponsor = await db.client.findFirst({ where: { sponsorForClientId: clientId } });
  if (!sponsor) return fail("No sponsor found for this case.", 404);

  await db.client.update({ where: { id: sponsor.id }, data: { visibleToClient } });
  await audit({
    firmId: me.firmId,
    actorType: "USER",
    actorId: me.id,
    action: visibleToClient ? "sponsor.visibleToClient.on" : "sponsor.visibleToClient.off",
    targetId: clientId,
  });

  return json({ ok: true });
});
