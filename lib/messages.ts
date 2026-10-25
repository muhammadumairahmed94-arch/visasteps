import type { User } from "@prisma/client";
import { db } from "./db";
import { encrypt, decrypt } from "./crypto";
import { sendSafely } from "./adapters/email";
import { appUrl } from "./accounts";
import { audit } from "./audit";
import { hit } from "./ratelimit";
import { UserError } from "./errors";

export const MAX_MSG_LEN = 2000;
const MSG_PURPOSE = "message";

const fullName = (c: { firstName: string | null; lastName: string | null; email: string }) =>
  c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.email;

export type MessageRow = {
  id: string;
  senderKind: "CLIENT" | "STAFF";
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type MessagesPayload = {
  messages: MessageRow[];
  closed: boolean;
};

export async function sendMessage(
  clientId: string,
  sender: { kind: "CLIENT" } | { kind: "STAFF"; user: User },
  text: string,
): Promise<MessageRow> {
  const trimmed = text.trim().slice(0, MAX_MSG_LEN);
  if (!trimmed) throw new UserError("Please write a message.");

  const client = await db.client.findUnique({
    where: { id: clientId },
    include: { caseworker: true, firm: true },
  });
  if (!client) throw new UserError("Client not found.");
  if (client.closedAt) throw new UserError("This case is closed. Messages cannot be sent.");

  const msg = await db.message.create({
    data: {
      clientId,
      senderKind: sender.kind,
      staffId: sender.kind === "STAFF" ? (sender as { kind: "STAFF"; user: User }).user.id : null,
      body: encrypt(trimmed, MSG_PURPOSE),
    },
    include: { staff: true },
  });

  const firmId = client.firmId;
  if (sender.kind === "CLIENT") {
    await audit({ firmId, actorType: "CLIENT", actorId: clientId, action: "message.send", targetId: clientId });
    const allowed = await hit("messageNotifyStaff", `cw:${clientId}`);
    if (allowed) {
      await sendSafely({
        to: client.caseworker.email,
        brand: client.firm.name,
        subject: `${fullName(client)} (${client.caseRef}) sent you a message`,
        text: "Sign in to read and reply.",
        action: { label: "View message", url: `${appUrl()}/staff#c/${clientId}/messages` },
      });
    }
  } else {
    const staffUser = (sender as { kind: "STAFF"; user: User }).user;
    await audit({ firmId, actorType: "USER", actorId: staffUser.id, action: "message.send", targetId: clientId });
    const allowed = await hit("messageNotifyClient", clientId);
    if (allowed) {
      await sendSafely({
        to: client.email,
        brand: client.firm.name,
        subject: `You have a new message from ${client.firm.name}`,
        text: "Sign in to read and reply.",
        action: { label: "View message", url: `${appUrl()}/#messages` },
      });
    }
  }

  return {
    id: msg.id,
    senderKind: msg.senderKind as "CLIENT" | "STAFF",
    senderName: sender.kind === "CLIENT" ? fullName(client) : client.caseworker.name,
    body: trimmed,
    createdAt: msg.createdAt.toISOString(),
    readAt: msg.readAt?.toISOString() ?? null,
  };
}

export async function listMessages(clientId: string): Promise<MessagesPayload> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      messages: { include: { staff: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!client) throw new UserError("Client not found.");

  return {
    closed: !!client.closedAt,
    messages: client.messages.map((m) => ({
      id: m.id,
      senderKind: m.senderKind as "CLIENT" | "STAFF",
      senderName: m.senderKind === "CLIENT" ? fullName(client) : (m.staff?.name ?? "Staff"),
      body: decrypt(m.body, MSG_PURPOSE),
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Mark all unread messages from the other party as read.
 * For staff: fires only when `staffId` matches the case's assigned caseworker.
 * Admins and non-assigned caseworkers viewing a thread leave messages unread.
 */
export async function markRead(clientId: string, by: "CLIENT" | "STAFF", staffId?: string): Promise<void> {
  if (by === "STAFF") {
    if (!staffId) return;
    const client = await db.client.findUnique({ where: { id: clientId }, select: { caseworkerId: true } });
    if (!client || client.caseworkerId !== staffId) return;
  }

  const counterKind = by === "CLIENT" ? "STAFF" : "CLIENT";
  await db.message.updateMany({
    where: { clientId, senderKind: counterKind, readAt: null },
    data: { readAt: new Date() },
  });

  // Reset the notification throttle so the next message triggers a fresh email
  if (by === "CLIENT") {
    await db.rateLimit.deleteMany({ where: { key: `messageNotifyClient:${clientId}` } });
  } else {
    await db.rateLimit.deleteMany({ where: { key: `messageNotifyStaff:cw:${clientId}` } });
  }
}

