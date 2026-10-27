import { safeEqual } from "@/lib/crypto";
import { processDocCheckRuns } from "@/lib/doc-check-runs";

/**
 * For hosts without a long-running server: call periodically with
 * "Authorization: Bearer <CRON_SECRET>" to process any queued doc-check runs.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("Forbidden", { status: 403 });
  await processDocCheckRuns();
  return Response.json({ ok: true });
}
