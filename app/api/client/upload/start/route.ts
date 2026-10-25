import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { MAX_BYTES } from "@/lib/files";

type PageSpec = { fileName: string; sizeBytes: number; sha256: string; totalChunks: number };

const MAX_PAGES = 20;

export const POST = handler(async (req) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);
  await limit("uploadStart", client.id);

  const { docId, pages, multiPage } = await body<{ docId: string; pages: PageSpec[]; multiPage: boolean }>(req);

  if (!docId || typeof docId !== "string") return fail("Missing document ID.");
  if (!Array.isArray(pages) || pages.length === 0) return fail("Please include at least one page.");
  if (pages.length > MAX_PAGES) return fail(`You can send up to ${MAX_PAGES} pages at a time.`);

  for (const p of pages) {
    if (typeof p.sizeBytes !== "number" || p.sizeBytes <= 0) return fail("Invalid page data.");
    if (typeof p.totalChunks !== "number" || p.totalChunks < 1) return fail("Invalid chunk count.");
    if (typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256)) return fail("Invalid checksum.");
    if (typeof p.fileName !== "string") return fail("Invalid file name.");
  }

  const totalBytes = pages.reduce((s, p) => s + p.sizeBytes, 0);
  if (totalBytes > MAX_BYTES) return fail("Total file size exceeds 20 MB.");

  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId: client.id },
    include: { client: true },
  });
  if (!doc) return fail("Document not found.");
  if (doc.client.closedAt) return fail("This case is closed. Please contact us if you need to send more documents.");
  if (doc.status === "OK") return fail("This document is already approved. You do not need to send it again.");

  const session = await db.uploadSession.create({
    data: {
      clientId: client.id,
      docId,
      pages: pages as unknown as object,
      multiPage: !!multiPage,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return json({ sessionId: session.id });
});
