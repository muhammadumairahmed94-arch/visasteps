import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { editRequirement, reviewRequirement } from "@/lib/requirements";

export const PATCH = handler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { id } = await params;
  const data = await body(req);

  if (data.action === "approve" || data.action === "reject") {
    await reviewRequirement(me, id, data);
  } else {
    await editRequirement(me, id, data);
  }

  return json({ ok: true });
});
