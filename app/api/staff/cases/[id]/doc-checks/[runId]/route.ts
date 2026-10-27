import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { getDocCheckRun } from "@/lib/doc-check-runs";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string; runId: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { id, runId } = await ctx.params;
  const run = await getDocCheckRun(me, id, runId);
  if (!run) return fail("Run not found", 404);
  return json(run);
});
