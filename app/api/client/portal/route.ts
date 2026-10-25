import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { clientPortalView, sponsorPortalView } from "@/lib/documents";
import { auditView } from "@/lib/audit";

export const GET = handler(async () => {
  const client = await currentClient();
  if (!client) return fail("Signed out", 401);

  if (client.sponsorForClientId) {
    // Sponsor: view parent case's SPONSOR-assigned documents
    await auditView({ firmId: client.firmId, actorType: "SPONSOR", actorId: client.id, action: "sponsor.view", targetId: client.sponsorForClientId });
    return json(await sponsorPortalView(client.id));
  }

  await auditView({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: "client.portal.view", targetId: client.id });
  return json(await clientPortalView(client.id));
});
