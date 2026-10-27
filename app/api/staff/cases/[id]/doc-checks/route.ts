import { currentStaff } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { checkDocuments } from "@/lib/doc-checks";

export const POST = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const { id } = await ctx.params;
  const results = await checkDocuments(me, id);
  return json({ results });
});
