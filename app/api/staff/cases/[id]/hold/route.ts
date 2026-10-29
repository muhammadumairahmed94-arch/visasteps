import { z } from "zod";
import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { setLegalHold } from "@/lib/retention";
import { limit } from "@/lib/ratelimit";

/** Set or clear a legal hold. Body: { hold: boolean; reason: string } */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Only admins can set a legal hold.", 403);
  await limit("caseHold", me.id);
  const v = z.object({ hold: z.boolean(), reason: z.string().trim().max(500).default("") }).safeParse(await body(req));
  if (!v.success) return fail(v.error.issues[0].message);
  return json({ message: await setLegalHold(me, (await ctx.params).id, v.data.hold, v.data.reason) });
});
