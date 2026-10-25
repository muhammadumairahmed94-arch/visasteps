import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findLink, hashPassword, passwordProblem } from "@/lib/accounts";
import { createCaseFolders } from "@/lib/cases";
import { startSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normaliseMobile } from "@/lib/naming";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";

const Details = z.object({
  firstName: z.string().trim().min(1, "Please enter your first name.").max(80),
  lastName: z.string().trim().min(1, "Please enter your last name.").max(80),
  mobile: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      return normaliseMobile(v) ?? (ctx.addIssue({ code: "custom", message: "Please check your mobile number, or leave it empty." }), z.NEVER);
    }),
});

/** Create the account (SETUP link) or choose a new password (RESET link). Signs the client in. */
export const POST = handler(async (req) => {
  await limit("link");
  const input = await body<{ token: string; password: string; firstName: string; lastName: string; mobile: string; remember?: unknown }>(req);
  const link = await findLink(input.token);
  if (!link) return fail("This link has expired or was already used.", 410);

  const password = String(input.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return fail(problem);

  const client = link.client;
  if (link.kind === "SETUP") {
    const details = Details.safeParse(input);
    if (!details.success) return fail(details.error.issues[0].message);
    const updated = await db.client.update({
      where: { id: client.id },
      data: { ...details.data, passwordHash: await hashPassword(password), accountCreatedAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    // OneDrive is slow (~0.75s a call): build the folders after the client is signed in. Uploads create any that are missing.
    after(async () => {
      const t = Date.now();
      await createCaseFolders(updated, updated.routeId)
        .then(() => console.log(`Case folders ready for ${updated.caseRef} in ${Date.now() - t} ms`))
        .catch((err) => console.error(`Case folders for ${updated.caseRef} not created yet:`, err instanceof Error ? err.message : err));
    });
  } else {
    await db.client.update({ where: { id: client.id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
    await db.session.deleteMany({ where: { clientId: client.id } }); // sign out other devices
  }

  const remember = input.remember === "on" || input.remember === true || input.remember === "true";
  await db.invite.update({ where: { id: link.id }, data: { usedAt: new Date() } });
  await startSession("client", { clientId: client.id }, "FULL", { remember });
  await audit({ firmId: client.firmId, actorType: "CLIENT", actorId: client.id, action: link.kind === "SETUP" ? "client.account.create" : "client.password.reset" });
  return json({ ok: true });
});
