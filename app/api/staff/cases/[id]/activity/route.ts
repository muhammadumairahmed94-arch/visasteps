import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { clientActivity } from "@/lib/activity";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const rows = await clientActivity(me, (await ctx.params).id);
  return rows ? json(rows) : fail("Not found", 404);
});
