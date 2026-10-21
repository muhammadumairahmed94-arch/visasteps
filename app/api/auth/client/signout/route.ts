import { currentClient, endSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { handler, json } from "@/lib/http";

export const POST = handler(async () => {
  const c = await currentClient();
  if (c) await audit({ firmId: c.firmId, actorType: "CLIENT", actorId: c.id, action: "client.signout" });
  await endSession("client");
  return json({ ok: true });
});
