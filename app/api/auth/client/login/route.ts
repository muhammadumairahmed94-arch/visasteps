import { checkLogin } from "@/lib/accounts";
import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

export const POST = handler(async (req) => {
  await limit("clientLogin");
  const { email, password, remember: rememberVal } = await body<{ email: string; password: string; remember?: unknown }>(req);
  if (!email || !password) return fail("Please enter your email and password.");
  // Checkbox sends "on" when ticked; key absent when unticked.
  const remember = rememberVal === "on" || rememberVal === true || rememberVal === "true";
  const r = await checkLogin(String(email), String(password));
  if (!r.ok) {
    if (r.client) await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.signin.failed" });
    return fail(r.message, 401);
  }
  await startSession("client", { clientId: r.client.id }, "FULL", { remember });
  await audit({ firmId: r.client.firmId, actorType: "CLIENT", actorId: r.client.id, action: "client.signin" });
  return json({ ok: true });
});
