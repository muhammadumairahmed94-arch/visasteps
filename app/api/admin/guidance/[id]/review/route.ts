import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { markGuidanceReviewed } from "@/lib/guidance";

export const POST = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  await markGuidanceReviewed(me, (await ctx.params).id);
  return json({ message: "Marked as reviewed." });
});
