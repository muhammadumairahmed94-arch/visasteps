import { z } from "zod";
import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { retentionDeleteCase, extendRetention } from "@/lib/retention";
import { limit } from "@/lib/ratelimit";

/** Extend retention. Body: { extraYears: number } */
export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Only admins can extend retention.", 403);
  await limit("adminRetention", me.id);
  const v = z.object({ extraYears: z.coerce.number().int().min(1).max(10), reason: z.string().min(1, "Enter a reason.") }).safeParse(await body(req));
  if (!v.success) return fail(v.error.issues[0].message);
  return json({ message: await extendRetention(me, (await ctx.params).id, v.data.extraYears, v.data.reason) });
});

/** Delete a case under the retention policy (early or on-time). */
export const DELETE = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Only admins can delete cases.", 403);
  await limit("adminRetention", me.id);
  return json({ message: await retentionDeleteCase(me, (await ctx.params).id) });
});
