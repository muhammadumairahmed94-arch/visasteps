import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { setGuidanceOwner } from "@/lib/guidance";
import { z } from "zod";
import { UserError } from "@/lib/errors";

const Input = z.object({ userId: z.string().nullable() });

export const PATCH = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  const routeId = (await ctx.params).id;
  const v = Input.safeParse(await body(req));
  if (!v.success) throw new UserError("Invalid input.");
  await setGuidanceOwner(me, routeId, v.data.userId);
  return json({ message: "Guidance owner updated." });
});
