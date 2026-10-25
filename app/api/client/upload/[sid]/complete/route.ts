import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { decryptBuffer, sha256 } from "@/lib/crypto";
import { uploadDocument } from "@/lib/documents";
import { MAX_BYTES } from "@/lib/files";

const CHUNK_PURPOSE = "upload-chunk";
const chunksDir = () =>
  path.join(path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue"), "upload-chunks");

type PageMeta = { fileName: string; sizeBytes: number; sha256: string; totalChunks: number };

export const POST = handler(async (req, ctx: { params: Promise<{ sid: string }> }) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);

  const { sid } = await ctx.params;
  const session = await db.uploadSession.findUnique({ where: { id: sid } });
  if (!session || session.clientId !== client.id) return fail("Session not found.", 404);
  if (session.expiresAt < new Date()) return fail("Upload session has expired.", 410);

  const pages = session.pages as PageMeta[];
  const fileInputs: { name: string; data: Buffer }[] = [];

  let totalBytes = 0;
  for (const [pi, meta] of pages.entries()) {
    const chunks: Buffer[] = [];
    for (let n = 0; n < meta.totalChunks; n++) {
      const p = path.join(chunksDir(), sid, String(pi), `${n}.bin`);
      const encrypted = await readFile(p).catch(() => null);
      if (!encrypted) return fail("Upload incomplete. Please try again.");
      chunks.push(decryptBuffer(encrypted, CHUNK_PURPOSE));
    }
    const data = Buffer.concat(chunks);
    if (data.length !== meta.sizeBytes) return fail("File size mismatch. Please try again.");
    if (sha256(data) !== meta.sha256) return fail("File checksum mismatch. Please try again.");
    totalBytes += data.length;
    if (totalBytes > MAX_BYTES) return fail("Total file size exceeds 20 MB.");
    fileInputs.push({ name: meta.fileName, data });
  }

  let result;
  try {
    result = await uploadDocument(client.id, session.docId, fileInputs, { multiPage: session.multiPage });
  } finally {
    // Always delete chunks and the session record, even if uploadDocument throws
    await rm(path.join(chunksDir(), sid), { recursive: true, force: true });
    await db.uploadSession.delete({ where: { id: sid } }).catch(() => {});
  }

  const days = result.reviewDays ?? 2;
  return json({ message: `Received. Your caseworker usually checks documents within ${days} working ${days === 1 ? "day" : "days"}.` });
});
