import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { acceptChecklistSuggestion } from "@/lib/requirements";

export const POST = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { id } = await params;
  const data = await body(req);
  await acceptChecklistSuggestion(me, id, data);
  return json({ ok: true });
});
