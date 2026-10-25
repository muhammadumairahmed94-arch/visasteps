import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json, body } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { MAX_BYTES } from "@/lib/files";
import { SERVER_CHUNK_SIZE, expectedChunkCount, sanitizeFileName } from "@/lib/upload-sessions";

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

  const normalizedPages: PageSpec[] = [];
  for (const [pi, p] of pages.entries()) {
    if (typeof p.sizeBytes !== "number" || p.sizeBytes <= 0) return fail(`Page ${pi + 1} has invalid size.`);
    if (typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256)) return fail(`Page ${pi + 1} has invalid checksum.`);
    if (typeof p.fileName !== "string") return fail(`Page ${pi + 1} has invalid file name.`);
    const wantChunks = expectedChunkCount(p.sizeBytes);
    if (typeof p.totalChunks !== "number" || p.totalChunks !== wantChunks)
      return fail(`Page ${pi + 1}: expected ${wantChunks} chunk${wantChunks === 1 ? "" : "s"} for ${p.sizeBytes} bytes (chunk size is ${SERVER_CHUNK_SIZE} bytes).`);
    normalizedPages.push({ ...p, fileName: sanitizeFileName(p.fileName) });
  }

  const totalBytes = normalizedPages.reduce((s, p) => s + p.sizeBytes, 0);
  if (totalBytes > MAX_BYTES) return fail("Total file size exceeds 20 MB.");

  // Sponsors upload to the parent case's documents
  const parentId = client.sponsorForClientId ?? client.id;
  const doc = await db.clientDocument.findFirst({
    where: { id: docId, clientId: parentId },
    include: {
      client: {
        include: { sponsorAccounts: { where: { closedAt: null }, select: { id: true } } },
      },
      checklistItem: { select: { assignedTo: true } },
    },
  });
  if (!doc) return fail("Document not found.");
  if (doc.client.closedAt) return fail("This case is closed. Please contact us if you need to send more documents.");
  if (doc.status === "OK") return fail("This document is already approved. You do not need to send it again.");

  // Verify the upload is to a document the uploader is allowed to upload
  const { resolvedOwner } = await import("@/lib/sponsor");
  const sponsorActive = doc.client.sponsorAccounts.length > 0;
  const owner = resolvedOwner(doc, sponsorActive);
  const isSponsorUpload = client.sponsorForClientId !== null;
  if (isSponsorUpload && owner !== "SPONSOR") return fail("Document not found.");
  if (!isSponsorUpload && owner !== "CLIENT") return fail("Document not found.");

  const session = await db.uploadSession.create({
    data: {
      clientId: client.id,
      docId,
      pages: normalizedPages as unknown as object,
      multiPage: !!multiPage,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return json({ sessionId: session.id });
});
