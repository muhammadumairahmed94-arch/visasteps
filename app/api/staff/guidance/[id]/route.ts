import { currentStaff } from "@/lib/auth";
import { fail, handler } from "@/lib/http";
import { readGuidanceFile } from "@/lib/guidance";

export const GET = handler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const result = await readGuidanceFile(me, (await ctx.params).id);
  if (!result) return fail("File not found.", 404);

  const { buffer, mimeType, fileName } = result;
  const safeAscii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

  if (mimeType === "application/pdf") {
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // HTML files: never serve inline — force download as opaque binary
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
