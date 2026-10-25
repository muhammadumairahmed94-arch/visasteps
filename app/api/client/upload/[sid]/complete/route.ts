import path from "node:path";
import { readFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { decryptBuffer, sha256 } from "@/lib/crypto";
import { uploadDocument } from "@/lib/documents";
import { MAX_BYTES } from "@/lib/files";
import { chunksDir, deleteSessionChunks } from "@/lib/upload-sessions";

const CHUNK_PURPOSE = "upload-chunk";

type PageMeta = { fileName: string; sizeBytes: number; sha256: string; totalChunks: number };

export const POST = handler(async (req, ctx: { params: Promise<{ sid: string }> }) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);

  const { sid } = await ctx.params;

  // Atomically claim the session: only proceed if completingAt was null.
  // This prevents two concurrent requests from both completing the same upload.
  const claimed = await db.uploadSession.updateMany({
    where: { id: sid, clientId: client.id, completingAt: null, expiresAt: { gt: new Date() } },
    data: { completingAt: new Date() },
  });
  if (claimed.count === 0) {
    const exists = await db.uploadSession.findFirst({ where: { id: sid, clientId: client.id } });
    if (!exists) return fail("Session not found.", 404);
    if (exists.expiresAt <= new Date()) return fail("Upload session has expired.", 410);
    // completingAt is already set: a concurrent request is (or was) processing this session
    return json({ message: "Already received." });
  }

  const session = await db.uploadSession.findUnique({ where: { id: sid } });
  if (!session) return fail("Session not found.", 404); // shouldn't happen (just claimed above)

  const pages = session.pages as PageMeta[];
  const fileInputs: { name: string; data: Buffer }[] = [];

  let totalBytes = 0;
  try {
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
  } finally {
    // Always delete chunks and the session record, even if assembly fails
    await deleteSessionChunks(sid);
    await db.uploadSession.delete({ where: { id: sid } }).catch(() => {});
  }

  const result = await uploadDocument(client.id, session.docId, fileInputs, { multiPage: session.multiPage });
  const days = result.reviewDays ?? 2;
  return json({ message: `Received. Your caseworker usually checks documents within ${days} working ${days === 1 ? "day" : "days"}.` });
});
