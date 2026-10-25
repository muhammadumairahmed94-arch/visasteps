import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "@/lib/db";
import { currentClient } from "@/lib/auth";
import { fail, handler, json } from "@/lib/http";
import { limit } from "@/lib/ratelimit";
import { encryptBuffer } from "@/lib/crypto";

const CHUNK_PURPOSE = "upload-chunk";
const chunksDir = () =>
  path.join(path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue"), "upload-chunks");

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

  const chunkData = Buffer.from(await req.arrayBuffer());
  if (!chunkData.length) return fail("Empty chunk.");

  const dir = path.join(chunksDir(), sid, String(page));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${n}.bin`), encryptBuffer(chunkData, CHUNK_PURPOSE), { mode: 0o600 });

  return json({ ok: true });
});
