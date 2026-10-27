import { z } from "zod";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { visibleCases } from "@/lib/documents";
import { UserError } from "@/lib/errors";

const RespondInput = z.object({
  action: z.enum(["AGREED", "DISAGREE"]),
  note: z.string().trim().max(2000).optional(),
});

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string; runId: string; itemId: string }> }) => {
    const me = await currentStaff();
    if (!me) return fail("Signed out", 401);

    const { id: clientId, runId, itemId } = await ctx.params;

    // Verify staff has access to this client
    const client = await db.client.findFirst({
      where: { id: clientId, ...visibleCases(me) },
      select: { id: true, firmId: true },
    });
    if (!client) return fail("Not found", 404);

    // Verify item belongs to this run and client
    const item = await db.guidanceCheckItem.findFirst({
      where: { id: itemId, runId, run: { clientId, firmId: me.firmId } },
      select: { id: true },
    });
    if (!item) return fail("Item not found", 404);

    const body = await req.json();
    const v = RespondInput.safeParse(body);
    if (!v.success) throw new UserError(v.error.issues[0].message);
    const { action, note } = v.data;

    await db.guidanceCheckResponse.upsert({
      where: { itemId_staffId: { itemId, staffId: me.id } },
      create: { itemId, staffId: me.id, action, note: note ?? null },
      update: { action, note: note ?? null, createdAt: new Date() },
    });

    await audit({
      firmId: me.firmId,
      actorType: "USER",
      actorId: me.id,
      action: action === "AGREED" ? "case.guidancecheck.agree" : "case.guidancecheck.disagree",
      targetId: clientId,
    });

    return json({ ok: true });
  },
);
