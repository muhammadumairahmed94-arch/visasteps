import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { db } from "./db";

/** Chunk size enforced by both server and client. */
export const SERVER_CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB

/** Max length of the file name the client may supply. */
export const MAX_FILE_NAME_LEN = 200;

export function chunksDir(): string {
  return path.join(
    path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue"),
    "upload-chunks",
  );
}

export async function deleteSessionChunks(sessionId: string): Promise<void> {
  await rm(path.join(chunksDir(), sessionId), { recursive: true, force: true });
}

/** Expected number of chunks for a given file size. */
export function expectedChunkCount(sizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / SERVER_CHUNK_SIZE));
}

/**
 * Expected byte-length of chunk n for a page.
 * All chunks except the last are exactly SERVER_CHUNK_SIZE.
 * The last chunk is the remainder (which equals SERVER_CHUNK_SIZE when
 * sizeBytes is an exact multiple).
 */
export function expectedChunkSize(sizeBytes: number, totalChunks: number, chunkIndex: number): number {
  const isLast = chunkIndex === totalChunks - 1;
  return isLast ? sizeBytes - (totalChunks - 1) * SERVER_CHUNK_SIZE : SERVER_CHUNK_SIZE;
}

/** Strip characters that could be path-traversal vectors; limit length. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, MAX_FILE_NAME_LEN).trim() || "upload";
}

/**
 * Deletes upload sessions that expired more than an hour ago (grace window),
 * their on-disk chunk folders, and any orphan chunk folders on disk that have
 * no matching session record.
 * Returns the number of expired session records removed.
 */
export async function purgeExpiredUploadSessions(): Promise<number> {
  const expired = await db.uploadSession.findMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    select: { id: true },
  });
  for (const s of expired) {
    await deleteSessionChunks(s.id);
    await db.uploadSession.delete({ where: { id: s.id } }).catch(() => {});
  }

  // Remove orphan chunk folders: on disk but no matching DB session
  try {
    const dirs = await readdir(chunksDir());
    const activeIds = new Set(
      (await db.uploadSession.findMany({ select: { id: true } })).map((s) => s.id),
    );
    await Promise.all(
      dirs
        .filter((d) => !activeIds.has(d))
        .map((d) => rm(path.join(chunksDir(), d), { recursive: true, force: true })),
    );
  } catch {
    // chunks directory does not exist yet — nothing to clean
  }

  return expired.length;
}
