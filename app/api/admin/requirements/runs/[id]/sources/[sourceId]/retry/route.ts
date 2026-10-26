import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { retryDraftSource } from "@/lib/requirements";

export const POST = handler(async (_req, { params }: { params: Promise<{ id: string; sourceId: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { sourceId } = await params;
  await retryDraftSource(me, sourceId);
  return json({ ok: true });
});
