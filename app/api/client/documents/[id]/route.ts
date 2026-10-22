import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { uploadDocument } from "@/lib/documents";
import { limit } from "@/lib/ratelimit";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);
  await limit("upload", client.id);
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const result = await uploadDocument(client.id, (await ctx.params).id, files);
  const days = result.reviewDays ?? 2;
  return json({ message: `Received. Your caseworker usually checks documents within ${days} working ${days === 1 ? "day" : "days"}.` });
});
