import { currentAdmin } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { changeUser } from "@/lib/admin";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  const input = await body<{ action: string; reassignTo?: string; role?: "ADMIN" | "CASEWORKER" }>(req);
  if (!["disable", "enable", "reset2fa", "sendLink", "role"].includes(String(input.action))) return fail("Unknown action");
  if (input.action === "role" && input.role !== "ADMIN" && input.role !== "CASEWORKER") return fail("Unknown role");
  return json({ message: await changeUser(me, (await ctx.params).id, input as Parameters<typeof changeUser>[2]) });
});
