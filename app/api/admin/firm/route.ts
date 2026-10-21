import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { updateFirm } from "@/lib/admin";

export const POST = handler(async (req) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  await updateFirm(me, await body(req));
  return json({ message: "Firm details saved" });
});
