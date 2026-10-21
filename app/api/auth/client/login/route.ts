import { checkLogin } from "@/lib/accounts";
import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

export const POST = handler(async (req) => {
  await limit("clientLogin");
  const { email, password } = await body<{ email: string; password: string }>(req);
  if (!email || !password) return fail("Please enter your email and password.");
  const r = await checkLogin(String(email), String(password));
  if (!r.ok) {
    if (r.client) await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.signin.failed" });
    return fail(r.message, 401);
  }
  await startSession("client", { clientId: r.client.id });
  await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.signin" });
  return json({ ok: true });
});
