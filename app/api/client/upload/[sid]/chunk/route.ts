import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { encryptBuffer } from "@/lib/crypto";
import { SERVER_CHUNK_SIZE, chunksDir, expectedChunkSize } from "@/lib/upload-sessions";

const CHUNK_PURPOSE = "upload-chunk";

type PageMeta = { fileName: string; sizeBytes: number; sha256: string; totalChunks: number };

export const PUT = handler(async (req, ctx: { params: Promise<{ sid: string }> }) => {
  const client = await currentClient();
  if (!client) return fail("Please sign in again.", 401);
  await limit("uploadChunk", client.id);

  const { sid } = await ctx.params;
  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "0");
  const n = Number(url.searchParams.get("n") ?? "0");

  const session = await db.uploadSession.findUnique({ where: { id: sid } });
  if (!session || session.clientId !== client.id) return fail("Session not found.", 404);
  if (session.expiresAt < new Date()) return fail("Upload session has expired.", 410);

  const pages = session.pages as PageMeta[];
  const pageMeta = pages[page];
  if (!pageMeta || n < 0 || n >= pageMeta.totalChunks) return fail("Invalid chunk index.");

  // Reject oversized chunks before reading the body
  const cl = Number(req.headers.get("content-length") ?? "0");
  if (cl > SERVER_CHUNK_SIZE) return fail("Chunk too large.", 413);

  // Stream-read body, stopping the moment it exceeds the limit
  const reader = req.body?.getReader();
  if (!reader) return fail("Empty chunk.", 400);
  const buffers: Buffer[] = [];
  let totalRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalRead += value.byteLength;
    if (totalRead > SERVER_CHUNK_SIZE) {
      await reader.cancel();
      return fail("Chunk too large.", 413);
    }
    buffers.push(Buffer.from(value));
  }
  const chunkData = Buffer.concat(buffers);
  if (!chunkData.length) return fail("Empty chunk.", 400);

  // Verify the chunk is exactly the right size for its position
  const want = expectedChunkSize(pageMeta.sizeBytes, pageMeta.totalChunks, n);
  if (chunkData.length !== want) return fail(`Unexpected chunk size: expected ${want} bytes, got ${chunkData.length}.`);

  const dir = path.join(chunksDir(), sid, String(page));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${n}.bin`), encryptBuffer(chunkData, CHUNK_PURPOSE), { mode: 0o600 });

  return json({ ok: true });
});
