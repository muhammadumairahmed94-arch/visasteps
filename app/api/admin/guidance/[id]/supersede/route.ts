import { currentAdmin } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { supersedeGuidance } from "@/lib/guidance";
import type { GuidanceFile } from "@/lib/guidance";

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentAdmin();
  if (!me) return fail("Admins only", 403);
  await limit("guidanceUpload", me.id);

  const oldId = (await ctx.params).id;
  const form = await req.formData();
  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) return fail("No file provided.", 400);

  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const file: GuidanceFile = { name: fileEntry.name, mimeType: fileEntry.type, buffer };

  const meta = {
    title: form.get("title") as string | null,
    govukUrl: form.get("govukUrl") as string | null,
    publishedAt: (form.get("publishedAt") as string | null) || null,
    lastUpdatedAt: (form.get("lastUpdatedAt") as string | null) || null,
    typeId: (form.get("typeId") as string | null) || null,
    routeIds: form.getAll("routeIds") as string[],
  };

  const id = await supersedeGuidance(me, oldId, file, meta);
  return json({ id, message: "New version uploaded. The old version has been archived." });
});
