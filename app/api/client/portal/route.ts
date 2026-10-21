import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { clientPortalView } from "@/lib/documents";
import { auditView } from "@/lib/audit";

export const GET = handler(async () => {
  const client = await currentClient();
  if (!client) return fail("Signed out", 401);
  await auditView({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "client.portal.view", targetId: client.id });
  return json(await clientPortalView(client.id));
});
