import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { removeGuidanceType } from "@/lib/guidance";

export const DELETE = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  await removeGuidanceType(me, (await ctx.params).id);
  return json({ message: "Source type removed." });
});
