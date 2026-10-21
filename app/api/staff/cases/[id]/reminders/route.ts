import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";

/** Pause or resume automatic reminders for one client. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { paused } = await body<{ paused: boolean }>(req);
  const where = me.role === "ADMIN" ? { firmId: me.firmId } : { firmId: me.firmId, caseworkerId: me.id };
  const done = await db.client.updateMany({ where: { id: (await ctx.params).id, ...where }, data: { remindersPaused: !!paused } });
  if (!done.count) return fail("Not found", 404);
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: paused ? "reminders.pause" : "reminders.resume", targetId: (await ctx.params).id });
  return json({ paused: !!paused });
});
