import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileUpload } from "@prisma/client";
import { db } from "./db";
import { decryptBuffer, encryptBuffer, randomToken } from "./crypto";
import { StorageConflict, saveUnique, storage } from "./adapters/storage";
import { GraphAuthLost, type GraphStorage } from "./adapters/graph";
import { getConnection } from "./onedrive-connection";
import { notifyOps } from "./alerts";
import { OLD_VERSIONS } from "./naming";

/**
 * Saving to OneDrive / SharePoint, with a safety net. Each file is saved straight away if Microsoft answers.
 * If not, an encrypted copy waits in UPLOAD_QUEUE_DIR and is retried with growing gaps (1, 2, 4 … 60 min).
 * After MAX_ATTEMPTS the file is marked FAILED and the caseworker can retry it by hand.
 * The waiting copy is deleted as soon as Microsoft confirms the save.
 */

const PURPOSE = "upload-queue";
const MAX_ATTEMPTS = 8;
const queueDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_QUEUE_DIR ?? "./upload-queue");
const split = (p: string) => p.split("/").filter(Boolean);
const backoff = (attempts: number) => new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** First save of a new upload. Never throws because of storage — it queues instead. */
export async function storeUpload(file: FileUpload, data: Buffer) {
  try {
    const saved = await saveUnique(storage(), split(file.folderPath), file.storedName, data);
    await db.fileUpload.update({
      where: { id: file.id },
      data: { storedName: saved.name, oneDriveItemId: saved.itemId, webUrl: saved.webUrl, storageStatus: "SAVED" },
    });
  } catch (e) {
    console.error(`Storage save failed for ${file.storedName}; queued for retry:`, errText(e));
    await mkdir(queueDir(), { recursive: true });
    const tempPath = path.join(queueDir(), `${randomToken()}.bin`);
    await writeFile(tempPath, encryptBuffer(data, PURPOSE), { mode: 0o600 });
    await db.$transaction([
      db.fileUpload.update({ where: { id: file.id }, data: { storageStatus: "PENDING" } }),
      db.storageJob.create({
        data: { kind: "UPLOAD", fileUploadId: file.id, folderPath: file.folderPath, name: file.storedName, tempPath, attempts: 1, lastError: errText(e), nextAttemptAt: backoff(0) },
      }),
    ]);
  }
}

/** After a redo: the old file goes to "_Old versions" in the same folder (never deleted). */
export async function moveToOldVersions(file: FileUpload) {
  const folderPath = [...split(file.folderPath), OLD_VERSIONS].join("/");
  if (file.storageStatus !== "SAVED" || !file.oneDriveItemId) {
    // Not in OneDrive yet: send the waiting upload straight to _Old versions instead
    await db.$transaction([
      db.storageJob.updateMany({ where: { fileUploadId: file.id, kind: "UPLOAD" }, data: { folderPath } }),
      db.fileUpload.update({ where: { id: file.id }, data: { folderPath, supersededAt: new Date() } }),
    ]);
    return;
  }
  await db.fileUpload.update({ where: { id: file.id }, data: { supersededAt: new Date() } });
  try {
    await doMove(file, folderPath, file.storedName);
  } catch (e) {
    console.error(`Move to ${OLD_VERSIONS} failed for ${file.storedName}; queued:`, errText(e));
    await db.storageJob.create({ data: { kind: "MOVE", fileUploadId: file.id, folderPath, name: file.storedName, attempts: 1, lastError: errText(e), nextAttemptAt: backoff(0) } });
  }
}

async function doMove(file: FileUpload, folderPath: string, name: string) {
  const store = storage();
  let moved;
  try {
    moved = await store.move(file.oneDriveItemId!, split(folderPath), name);
  } catch (e) {
    if (!(e instanceof StorageConflict)) throw e;
    moved = await store.move(file.oneDriveItemId!, split(folderPath), name.replace(/(\.\w+)?$/, `_replaced-${Date.now()}$1`));
  }
  await db.fileUpload.update({ where: { id: file.id }, data: { folderPath, storedName: moved.name, oneDriveItemId: moved.itemId, webUrl: moved.webUrl ?? file.webUrl } });
}

/** Works through due jobs, oldest first. Safe to run from several servers at once (jobs are claimed). */
export async function processQueue(limit = 20): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  const due = await db.storageJob.findMany({
    where: { nextAttemptAt: { lte: new Date() }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const job of due) {
    const claimed = await db.storageJob.updateMany({
      where: { id: job.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: { lockedUntil: new Date(Date.now() + 5 * 60_000) },
    });
    if (!claimed.count) continue;
    const file = await db.fileUpload.findUnique({ where: { id: job.fileUploadId } });
    try {
      if (!file) throw new Error("File record missing");
      if (job.kind === "UPLOAD") {
        const data = decryptBuffer(await readFile(job.tempPath!), PURPOSE);
        const saved = await saveUnique(storage(), split(job.folderPath), job.name, data);
        await db.fileUpload.update({
          where: { id: file.id },
          data: { folderPath: job.folderPath, storedName: saved.name, oneDriveItemId: saved.itemId, webUrl: saved.webUrl, storageStatus: "SAVED" },
        });
        await rm(job.tempPath!, { force: true }); // confirmed saved: drop the local copy
      } else {
        await doMove(file, job.folderPath, job.name);
      }
      await db.storageJob.delete({ where: { id: job.id } });
      done++;
    } catch (e) {
      if (e instanceof GraphAuthLost) {
        // Sign-in lost: not the file's fault. Wait without using up attempts, and stop this run.
        await db.storageJob.update({ where: { id: job.id }, data: { lastError: errText(e), lockedUntil: null, nextAttemptAt: new Date(Date.now() + 10 * 60_000) } });
        break;
      }
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.storageJob.update({
        where: { id: job.id },
        data: { attempts, lastError: errText(e), lockedUntil: null, nextAttemptAt: giveUp ? new Date("9999-01-01") : backoff(attempts) },
      });
      if (giveUp && file && job.kind === "UPLOAD") {
        await db.fileUpload.update({ where: { id: file.id }, data: { storageStatus: "FAILED" } });
        await notifyOps("storage-failed", "a file could not be saved to OneDrive", `After ${attempts} tries a client file is still not in OneDrive (last error: ${errText(e)}).\nCaseworkers see it marked "Not saved" with a Retry button. The encrypted copy is kept on the server.`);
      }
      failed++;
    }
  }
  return { done, failed };
}

/** Caseworker pressed "Retry": try again now. */
export async function retryNow(fileUploadId: string) {
  await db.storageJob.updateMany({ where: { fileUploadId }, data: { attempts: 0, nextAttemptAt: new Date(), lockedUntil: null } });
  await db.fileUpload.updateMany({ where: { id: fileUploadId, storageStatus: "FAILED" }, data: { storageStatus: "PENDING" } });
  await processQueue();
  return db.fileUpload.findUnique({ where: { id: fileUploadId }, include: { jobs: true } });
}

/** The waiting encrypted copy, so a caseworker can still open a file that is not in OneDrive yet. */
export async function readQueued(fileUploadId: string): Promise<Buffer | null> {
  const job = await db.storageJob.findFirst({ where: { fileUploadId, kind: "UPLOAD" } });
  return job?.tempPath ? decryptBuffer(await readFile(job.tempPath), PURPOSE) : null;
}

/**
 * Personal OneDrive sign-ins lapse if unused for a long time. Touch Microsoft every few days so a quiet
 * week never forces the owner to sign in again.
 */
export async function keepAlive(everyDays = 3) {
  if (process.env.STORAGE_PROVIDER !== "onedrive") return;
  const c = await getConnection();
  if (!c.refreshToken || c.status === "reconnect") return;
  if (c.lastRefreshAt && Date.now() - Date.parse(c.lastRefreshAt) < everyDays * 86_400_000) return;
  await (storage() as GraphStorage).whoAmI();
}
