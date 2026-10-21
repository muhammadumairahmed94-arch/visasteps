import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { addUser } from "@/lib/admin";

export const POST = handler(async (req) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  const { sent } = await addUser(me, await body(req));
  return json({ message: sent ? "Added. A \"set your password\" email has been sent." : "Added, but the email could not be sent. Use \"Send password link\" once email works." });
});
