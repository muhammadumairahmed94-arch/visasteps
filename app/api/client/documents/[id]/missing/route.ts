import { currentClient } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { reportMissing } from "@/lib/documents";
import { limit } from "@/lib/ratelimit";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);
  await limit("reportMissing", client.id);
  const { reason } = await body<{ reason: string }>(req);
  await reportMissing(client.id, (await ctx.params).id, String(reason ?? ""));
  return json({ message: "Saved. Your caseworker has been told." });
});
