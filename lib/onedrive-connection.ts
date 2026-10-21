import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import type { RefreshStore } from "./adapters/graph";
import { notifyOps } from "./alerts";

/**
 * Personal OneDrive sign-in, kept in Firm.oneDriveConfig. The refresh token is encrypted with AUTH_SECRET.
 * The portal serves one firm, so the first (only) firm row holds it.
 */

const PURPOSE = "onedrive-refresh";

export type Connection = {
  refreshToken?: string; // encrypted
  account?: string;
  connectedAt?: string;
  lastRefreshAt?: string;
  status?: "ok" | "reconnect";
  reason?: string;
};

async function firm() {
  const f = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!f) throw new Error("No firm set up");
  return f;
}

export async function getConnection(): Promise<Connection> {
  return ((await firm()).oneDriveConfig ?? {}) as Connection;
}

async function update(patch: Connection) {
  const f = await firm();
  const next = { ...((f.oneDriveConfig ?? {}) as Connection), ...patch };
  await db.firm.update({ where: { id: f.id }, data: { oneDriveConfig: next as Prisma.InputJsonValue } });
}

/** Saved by `npm run setup:onedrive` after a successful sign-in and test. */
export async function connect(refreshToken: string, account: string) {
  const now = new Date().toISOString();
  await update({ refreshToken: encrypt(refreshToken, PURPOSE), account, connectedAt: now, lastRefreshAt: now, status: "ok", reason: undefined });
}

export const dbRefreshStore: RefreshStore = {
  async load() {
    const c = await getConnection();
    if (!c.refreshToken) throw new Error("OneDrive is not connected — run npm run setup:onedrive");
    return decrypt(c.refreshToken, PURPOSE);
  },
  async save(refreshToken) {
    await update({ refreshToken: encrypt(refreshToken, PURPOSE), lastRefreshAt: new Date().toISOString(), status: "ok", reason: undefined });
  },
  async lost(reason) {
    await update({ status: "reconnect", reason });
    await notifyOps("onedrive", "OneDrive needs to be connected again", `Microsoft no longer accepts the saved OneDrive sign-in (${reason}).\n\nUploads are kept safely on the server until it is fixed. On the server run:\n  docker compose run --rm tools npm run setup:onedrive`, 24 * 60);
  },
};

/** For the caseworker banner: null when all is well. */
export async function storageWarning(): Promise<string | null> {
  if (process.env.STORAGE_PROVIDER !== "onedrive") return null;
  const c = await getConnection().catch(() => ({}) as Connection);
  if (!c.refreshToken) return "OneDrive is not connected yet. Uploads are kept safely and will be saved once it is connected.";
  if (c.status === "reconnect") return "OneDrive needs to be connected again. Uploads are kept safely until then. The account owner should run: npm run setup:onedrive";
  return null;
}
