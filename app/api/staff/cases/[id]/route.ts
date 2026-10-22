import { z } from "zod";
import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { staffCaseView, visibleCases } from "@/lib/documents";
import { auditView } from "@/lib/audit";
import { audit } from "@/lib/audit";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const view = await staffCaseView(me, (await ctx.params).id);
  if (!view) return fail("Not found", 404);
  await auditView({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "staff.case.view", targetId: view.client.id });
  return json(view);
});

const PatchCase = z.object({
  plannedSubmissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format").nullable(),
});

export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const clientId = (await ctx.params).id;
  const client = await db.client.findFirst({ where: { id: clientId, ...visibleCases(me) } });
  if (!client) return fail("Not found", 404);
  const v = PatchCase.safeParse(await body(req));
  if (!v.success) return fail(v.error.issues[0].message);
  await db.client.update({
    where: { id: clientId },
    data: { plannedSubmissionDate: v.data.plannedSubmissionDate ? new Date(v.data.plannedSubmissionDate) : null },
  });
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "staff.case.submissionDate", targetId: clientId });
  return json({ message: "Saved" });
});
