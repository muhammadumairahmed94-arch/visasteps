import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { reviewDocument } from "@/lib/documents";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { action, note } = await body<{ action: string; note: string }>(req);
  if (action !== "approve" && action !== "redo") return fail("Unknown action");
  const { warning } = await reviewDocument(me, (await ctx.params).id, action, note ? String(note) : undefined);
  return json({ ok: true, warning });
});
