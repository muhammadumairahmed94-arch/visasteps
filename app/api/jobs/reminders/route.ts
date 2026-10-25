import path from "node:path";
import { rm } from "node:fs/promises";
import { safeEqual } from "@/lib/crypto";
import { sendDueReminders } from "@/lib/reminders";
import { db } from "@/lib/db";

const chunksDir = () =>
  path.join(path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue"), "upload-chunks");

/** Scheduled hosts: call hourly with "Authorization: Bearer <CRON_SECRET>". Sends nothing outside 9am–7pm UK time. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return new Response("Forbidden", { status: 403 });

  const reminders = await sendDueReminders();

  // Clean up upload sessions that expired more than an hour ago (gives clients a grace window)
  const expired = await db.uploadSession.findMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });
  let cleaned = 0;
  for (const s of expired) {
    await rm(path.join(chunksDir(), s.id), { recursive: true, force: true });
    await db.uploadSession.delete({ where: { id: s.id } }).catch(() => {});
    cleaned++;
  }

  return Response.json({ ...reminders, expiredUploadSessionsCleaned: cleaned });
}
