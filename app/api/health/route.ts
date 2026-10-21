import { health } from "@/lib/health";

/** Uptime monitor target: 200 with "ok":true when everything works, 503 otherwise. */
export async function GET() {
  const h = await health();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
