import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { auditView } from "@/lib/audit";
import { limit } from "@/lib/ratelimit";
import { visibleCases } from "@/lib/documents";
import { db } from "@/lib/db";
import { sendMessage, listMessages, markRead } from "@/lib/messages";

export const GET = handler(async (req, ctx: { params: Promise<{ clientId: string }> }) => {
  const user = await currentStaff();
  if (!user) return fail("Please sign in.", 401);

  const { clientId } = await ctx.params;
  const client = await db.client.findFirst({ where: { id: clientId, ...visibleCases(user) } });
  if (!client) return fail("Not found.", 404);

  const payload = await listMessages(clientId);
  // Only the assigned caseworker marks client messages as read (admin views are silent)
  await markRead(clientId, "STAFF", user.id);
  await auditView({ firmId: user.firmId, actorType: "USER", actorId: user.id, action: "message.view", targetId: clientId });

  return json(payload);
});

export const POST = handler(async (req, ctx: { params: Promise<{ clientId: string }> }) => {
  const user = await currentStaff();
  if (!user) return fail("Please sign in.", 401);

  const { clientId } = await ctx.params;
  const client = await db.client.findFirst({ where: { id: clientId, ...visibleCases(user) } });
  if (!client) return fail("Not found.", 404);

  await limit("messageStaff", user.id);

  const { text } = await body<{ text: string }>(req);
  if (typeof text !== "string") return fail("text is required.");

  const msg = await sendMessage(clientId, { kind: "STAFF", user }, text);
  return json(msg, 201);
});
