import { currentStaff, endSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { handler, json } from "@/lib/http";

export const POST = handler(async () => {
  const u = await currentStaff();
  if (u) await audit({ firmId: u.firmId, actorType: "USER", actorId: u.id, action: "staff.signout" });
  await endSession("staff");
  return json({ ok: true });
});
