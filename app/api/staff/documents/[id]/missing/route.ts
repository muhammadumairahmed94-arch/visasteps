import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { respondToMissing } from "@/lib/documents";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { note } = await body<{ note: string }>(req);
  await respondToMissing(me, (await ctx.params).id, String(note ?? ""));
  return json({ message: note?.trim() ? "Reply sent to client" : "Flag cleared" });
});
