import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { addGuidanceType } from "@/lib/guidance";

export const POST = handler(async (req) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  const id = await addGuidanceType(me, await body(req));
  return json({ id, message: "Source type added." });
});
