import type { ActorType } from "@prisma/client";
import { db } from "./db";
import { requestIp } from "./auth";

type Entry = { firmId: string; actorType: ActorType; actorId?: string | null; action: string; targetId?: string | null };

export async function audit(e: Entry) {
  await db.auditLog.create({ data: { ...e, ip: await requestIp().catch(() => null) } });
}

/** For "viewed" events: one entry per person and target every 30 minutes, not one per page refresh. */
export async function auditView(e: Entry, minutes = 30) {
  const recent = await db.auditLog.findFirst({
    where: { firmId: e.firmId, actorId: e.actorId, action: e.action, targetId: e.targetId ?? null, at: { gt: new Date(Date.now() - minutes * 60 * 1000) } },
    select: { id: true },
  });
  if (!recent) await audit(e);
}
