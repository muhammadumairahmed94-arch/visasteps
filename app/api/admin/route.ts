import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { adminView } from "@/lib/admin";

export const GET = handler(async () => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  return json(await adminView(me));
});
