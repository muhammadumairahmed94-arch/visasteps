import { safeEqual } from "@/lib/crypto";
import { sendDueReminders } from "@/lib/reminders";

/** Scheduled hosts: call hourly with "Authorization: Bearer <CRON_SECRET>". Sends nothing outside 9am–7pm UK time. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("Forbidden", { status: 403 });
  return Response.json(await sendDueReminders());
}
