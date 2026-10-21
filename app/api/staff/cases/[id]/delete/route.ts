import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { deleteClient } from "@/lib/closure";

/** Permanently delete a client's portal record (admins). Body: { confirm: "<case reference>" } */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Only admins can delete a client.", 403);
  const { confirm } = await body<{ confirm: string }>(req);
  return json({ message: await deleteClient(me, (await ctx.params).id, String(confirm ?? "")) });
});
