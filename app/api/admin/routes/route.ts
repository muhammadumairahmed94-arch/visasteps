import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { addRoute } from "@/lib/admin";

export const POST = handler(async (req) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  return json({ id: await addRoute(me, await body(req)), message: "Visa route added" });
});
