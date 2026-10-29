import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { listRetentionCases } from "@/lib/retention";

/** List all closed cases with retention due dates (warning ≤30 days or overdue). */
export const GET = handler(async () => {
  const me = await currentAdmin();
  if (!me) return fail("Only admins can view the deletion list.", 403);
  return json(await listRetentionCases(me.firmId));
});
