import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { ignoreChecklistSuggestion } from "@/lib/requirements";

export const POST = handler(async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { id } = await params;
  await ignoreChecklistSuggestion(me, id);
  return json({ ok: true });
});
