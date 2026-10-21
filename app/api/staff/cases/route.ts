import { z } from "zod";
import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { staffCaseList } from "@/lib/documents";
import { storageWarning } from "@/lib/onedrive-connection";
import { createClient } from "@/lib/cases";
import { sendSetupLink } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { limit } from "@/lib/ratelimit";

export const GET = handler(async () => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  const [cases, routes, caseworkers] = await Promise.all([
    staffCaseList(me),
    db.route.findMany({ where: { firmId: me.firmId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { firmId: me.firmId, disabledAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return json({ me: { id: me.id, name: me.name, role: me.role }, cases, routes, caseworkers, storageWarning: await storageWarning() });
});

const NewClient = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase(),
  routeId: z.string().min(1, "Choose a visa route"),
  caseworkerId: z.string().min(1, "Choose a caseworker"),
});

export const POST = handler(async (req) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);
  await limit("createClient", me.id);
  const parsed = NewClient.safeParse(await body(req));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (await db.client.findUnique({ where: { email: parsed.data.email } })) return fail("There is already a client with this email.");
  const client = await createClient(me.firmId, parsed.data);
  const firm = await db.firm.findUniqueOrThrow({ where: { id: me.firmId } });
  const sent = await sendSetupLink(client, firm);
  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "client.create", targetId: client.id });
  return json({
    id: client.id,
    caseRef: client.caseRef,
    warning: sent ? undefined : "Client created, but the invite email could not be sent. Use “Copy invite link” below to send it by WhatsApp.",
  });
});
