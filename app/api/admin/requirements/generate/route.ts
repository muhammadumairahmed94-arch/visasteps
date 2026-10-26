import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { generateRequirements } from "@/lib/requirements";

export const POST = handler(async (req) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);

  const { routeId } = await body<{ routeId: string }>(req);
  if (!routeId) return fail("routeId is required", 400);

  const runId = await generateRequirements(me, routeId);
  return json({ runId });
});
