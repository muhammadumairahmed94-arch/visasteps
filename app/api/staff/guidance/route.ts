import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { guidanceView } from "@/lib/guidance";

export const GET = handler(async () => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  return json(await guidanceView(me));
});
