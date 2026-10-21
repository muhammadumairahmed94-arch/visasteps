import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { setCaseClosed } from "@/lib/closure";

/** Close or reopen a case. Body: { closed: boolean } */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { closed } = await body<{ closed: boolean }>(req);
  return json({ message: await setCaseClosed(me, (await ctx.params).id, closed === true) });
});
