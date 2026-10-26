import { z } from "zod";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { getAnalysisView, askCaseQuestion } from "@/lib/case-analysis";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { id } = await ctx.params;
  const view = await getAnalysisView(me, id);
  if (!view) return fail("Not found", 404);
  return json(view);
});

const AskBody = z.object({
  question: z.string().trim().min(1, "Question is required").max(2000),
  folders: z.array(z.string()).optional(),
});

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { id } = await ctx.params;
  const parsed = AskBody.safeParse(await body(req));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const result = await askCaseQuestion(me, id, parsed.data.question, parsed.data.folders);
  return json(result);
});
