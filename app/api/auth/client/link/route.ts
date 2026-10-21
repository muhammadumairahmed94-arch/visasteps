import { findLink } from "@/lib/accounts";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

/** What a link from an email is for, so the page can show the right form. */
export const POST = handler(async (req) => {
  await limit("link");
  const { token } = await body<{ token: string }>(req);
  const link = await findLink(token);
  if (!link) return fail("This link has expired or was already used.", 410);
  return json({ kind: link.kind, email: link.client.email, firm: link.client.firm.name });
});
