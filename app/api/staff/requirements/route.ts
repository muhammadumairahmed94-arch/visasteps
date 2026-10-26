import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { requirementsView } from "@/lib/requirements";

export const GET = handler(async () => {
  const me = await currentStaff();
  if (!me) return fail("Sign in required", 401);
  return json(await requirementsView(me));
});
