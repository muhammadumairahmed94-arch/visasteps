import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { staffCaseView } from "@/lib/documents";
import { auditView } from "@/lib/audit";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const view = await staffCaseView(me, (await ctx.params).id);
  if (!view) return fail("Not found", 404);
  await auditView({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "staff.case.view", targetId: view.client.id });
  return json(view);
});
