import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { addItem } from "@/lib/admin";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  const { added } = await addItem(me, (await ctx.params).id, await body(req));
  return json({ message: added ? `Document added, and to ${added} existing client${added === 1 ? "" : "s"}` : "Document added" });
});
