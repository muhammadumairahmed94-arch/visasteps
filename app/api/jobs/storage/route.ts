import { safeEqual } from "@/lib/crypto";
import { processQueue } from "@/lib/storage-queue";

/**
 * For hosts without a long-running server (e.g. Vercel Cron): call every few minutes with
 * "Authorization: Bearer <CRON_SECRET>". Retries any OneDrive saves that are waiting.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("Forbidden", { status: 403 });
  return Response.json(await processQueue(50));
}
