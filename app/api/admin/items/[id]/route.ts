import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { changeItem } from "@/lib/admin";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  await changeItem(me, (await ctx.params).id, await body(req));
  return json({ message: "Saved" });
});
