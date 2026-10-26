import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { deleteQuestion } from "@/lib/case-analysis";

export const DELETE = handler(async (_req, ctx: { params: Promise<{ id: string; questionId: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { questionId } = await ctx.params;
  await deleteQuestion(me, questionId);
  return json({ ok: true });
});
