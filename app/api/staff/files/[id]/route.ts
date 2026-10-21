import { currentStaff } from "@/lib/auth";
import { fail, handler } from "@/lib/http";
import { staffReadFile } from "@/lib/documents";

const TYPES: Record<string, string> = { pdf: "application/pdf", heic: "image/heic" };

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const file = await staffReadFile(me, (await ctx.params).id);
  if (!file) return fail("This file could not be found. It may still be saving — try again shortly.", 404);
  const ext = file.name.split(".").pop()!.toLowerCase();
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // ASCII fallback + UTF-8 name (RFC 6266/5987): surnames may use any script, e.g. Urdu or Turkish letters
      "Content-Disposition": `inline; filename="${file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
