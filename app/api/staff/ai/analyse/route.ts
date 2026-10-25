import { z } from "zod";
import { db } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { visibleCases } from "@/lib/documents";
import { ai } from "@/lib/adapters/ai";
import { limit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

const Input = z.object({
  documentId: z.string().min(1),
  text: z.string().min(10, "Document text is too short to analyse.").max(12_000, "Document text is too long (max 12,000 characters)."),
});

export const POST = handler(async (req) => {
  const me = await currentStaff();
  if (!me) return fail("Signed out", 401);

  const firm = await db.firm.findUniqueOrThrow({ where: { id: me.firmId } });
  if (!firm.aiEnabled) return fail("AI analysis is not enabled for this firm.", 403);

  let adapter;
  try {
    adapter = ai();
    // Probe "off" eagerly before consuming the rate limit
    if (process.env.AI_PROVIDER === "off") return fail("AI provider is not available.", 503);
  } catch {
    return fail("AI provider is not available.", 503);
  }

  await limit("aiAnalyse", me.id);

  const parsed = Input.safeParse(await body(req));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { documentId, text } = parsed.data;

  const doc = await db.clientDocument.findFirst({
    where: { id: documentId, client: visibleCases(me) },
    include: { checklistItem: { select: { title: true } } },
  });
  if (!doc) return fail("Not found", 404);

  let result;
  try {
    result = await adapter.analyse({ text, docTitle: doc.checklistItem.title });
  } catch {
    return fail("AI analysis could not be completed. Please try again.", 502);
  }

  await audit({ firmId: me.firmId, actorType: "USER", actorId: me.id, action: "ai.analyse", targetId: documentId });

  return json({ summary: result.summary, flags: result.flags });
});
