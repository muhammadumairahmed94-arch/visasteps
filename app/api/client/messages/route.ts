import { currentClient } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { auditView } from "@/lib/audit";
import { limit } from "@/lib/ratelimit";
import { sendMessage, listMessages, markRead } from "@/lib/messages";

export const GET = handler(async () => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);

  const payload = await listMessages(client.id);
  await markRead(client.id, "CLIENT");
  await auditView({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "message.view", targetId: client.id });

  return json(payload);
});

export const POST = handler(async (req) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);

  await limit("messageClient", client.id);

  const { text } = await body<{ text: string }>(req);
  if (typeof text !== "string") return fail("text is required.");

  const msg = await sendMessage(client.id, { kind: "CLIENT" }, text);
  return json(msg, 201);
});
