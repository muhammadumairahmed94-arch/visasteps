import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json } from "@/lib/http";
import { retryNow } from "@/lib/storage-queue";

/** Caseworker "Retry" for a file that has not reached OneDrive. */
export const POST = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const where = me.role === "ADMIN" ? { firmId: me.firmId } : { firmId: me.firmId, caseworkerId: me.id };
  const file = await db.fileUpload.findFirst({ where: { id: (await ctx.params).id, clientDocument: { client: where } } });
  if (!file) return fail("Not found", 404);
  const after = await retryNow(file.id);
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "storage.retry", targetId: file.id });
  return json({ storage: after?.storageStatus, error: after?.jobs[0]?.lastError ?? null });
});
