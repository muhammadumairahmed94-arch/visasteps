import { StorageConflict, cleanSegment, type FolderPath, type StorageAdapter, type StoredItem } from "./storage";
import { dbRefreshStore } from "../onedrive-connection";

/**
 * Microsoft Graph storage, two modes:
 *  - "site"     (Microsoft 365 Business): one SharePoint document library, app-only sign-in, Sites.Selected.
 *  - "personal" (Microsoft 365 Personal/Family): the owner's OneDrive app folder (OneDrive/Apps/<app name>),
 *               Files.ReadWrite.AppFolder only, using a refresh token from a one-time sign-in.
 * Docs: https://learn.microsoft.com/graph/api/resources/driveitem
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SIMPLE_MAX = 4 * 1024 * 1024; // larger files use an upload session
const CHUNK = 320 * 1024 * 16; // 5 MiB — Graph needs multiples of 320 KiB

export interface SiteConfig {
  mode?: "site";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** e.g. https://uhalegal.sharepoint.com/sites/ClientFiles */
  siteUrl: string;
  /** Document library name; default "Documents" (shown as "Documents" or "Shared Documents"). */
  library?: string;
}

/** Where the personal-mode refresh token lives. Microsoft issues a new one on every refresh. */
export interface RefreshStore {
  load(): Promise<string>;
  save(refreshToken: string): Promise<void>;
  /** Called when Microsoft refuses the token (password changed, access removed, unused for months). */
  lost(reason: string): Promise<void>;
}

export interface PersonalConfig {
  mode: "personal";
  clientId: string;
  tokens: RefreshStore;
}

export type GraphConfig = SiteConfig | PersonalConfig;

export const PERSONAL_SCOPE = "Files.ReadWrite.AppFolder offline_access openid profile";

type DriveItem = { id: string; name: string; webUrl?: string; folder?: unknown };

/** Microsoft no longer accepts the saved sign-in; the owner must connect again (npm run setup:onedrive). */
export class GraphAuthLost extends Error {}

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const enc = (segments: string[]) => segments.map((s) => encodeURIComponent(cleanSegment(s))).join("/");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GraphStorage implements StorageAdapter {
  private token?: { value: string; expires: number };
  private refreshing?: Promise<string>;
  private driveId?: string;
  private paths?: { items: string; root: string; rootId: string };
  private folders = new Set<string>(); // folders known to exist this process

  constructor(
    private cfg: GraphConfig,
    private http: typeof fetch = fetch,
  ) {}

  /* ---------- plumbing ---------- */

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    if (this.cfg.mode === "personal") return (this.refreshing ??= this.personalToken().finally(() => (this.refreshing = undefined)));
    const cfg = this.cfg;
    const res = await this.http(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) throw new GraphError(`Microsoft sign-in failed: ${body.error_description?.split("\r\n")[0] ?? res.status}`, res.status);
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Personal mode: swap the saved refresh token for an access token, and save the new refresh token. */
  private async personalToken(): Promise<string> {
    const cfg = this.cfg as PersonalConfig;
    const res = await this.http("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, grant_type: "refresh_token", refresh_token: await cfg.tokens.load(), scope: PERSONAL_SCOPE }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      const reason = `${body.error ?? res.status}: ${body.error_description?.split("\r\n")[0] ?? ""}`.trim();
      if (["invalid_grant", "interaction_required", "consent_required"].includes(body.error ?? "")) {
        await cfg.tokens.lost(reason);
        throw new GraphAuthLost(`OneDrive sign-in has expired — run npm run setup:onedrive (${reason})`);
      }
      throw new GraphError(`Microsoft sign-in failed: ${reason}`, res.status);
    }
    if (body.refresh_token) await cfg.tokens.save(body.refresh_token);
    this.token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Calls Graph with the app token; waits and retries on throttling (429/503) up to 3 times. */
  private async call(pathOrUrl: string, init: RequestInit = {}, { auth = true } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      if (auth) headers.set("Authorization", `Bearer ${await this.accessToken()}`);
      const res = await this.http(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`, { ...init, headers });
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt;
        await sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      if (res.status === 401 && auth && attempt === 0) {
        this.token = undefined; // token revoked or expired early: get a new one once
        continue;
      }
      return res;
    }
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const msg = `${what}: ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim();
    if (res.status === 409) throw new StorageConflict(msg);
    throw new GraphError(msg, res.status);
  }

  /** URL prefixes for the storage area: the site's library, or the personal app folder. Looked up once. */
  private async base() {
    if (this.paths) return this.paths;
    if (this.cfg.mode === "personal") {
      const app = await this.json<DriveItem>(await this.call("/me/drive/special/approot"), "Open the app folder in OneDrive");
      return (this.paths = { items: "/me/drive/items", root: "/me/drive/special/approot", rootId: app.id });
    }
    const d = await this.drive();
    return (this.paths = { items: `/drives/${d}/items`, root: `/drives/${d}/root`, rootId: "root" });
  }

  /** The SharePoint site's document library, looked up once (site mode). */
  async drive(): Promise<string> {
    if (this.driveId) return this.driveId;
    if (this.cfg.mode === "personal") throw new Error("drive() is for site mode");
    const u = new URL(this.cfg.siteUrl);
    const site = await this.json<{ id: string }>(await this.call(`/sites/${u.hostname}:${u.pathname.replace(/\/$/, "")}`), "Find SharePoint site");
    const drives = await this.json<{ value: { id: string; name: string }[] }>(await this.call(`/sites/${site.id}/drives`), "List document libraries");
    const want = (this.cfg.library ?? "Documents").toLowerCase();
    const d = drives.value.find((x) => x.name.toLowerCase() === want) ?? (want === "documents" ? drives.value.find((x) => x.name === "Shared Documents") : undefined);
    if (!d) throw new GraphError(`Document library "${this.cfg.library ?? "Documents"}" not found. Libraries: ${drives.value.map((x) => x.name).join(", ")}`, 404);
    return (this.driveId = d.id);
  }

  private async itemByPath(segments: string[]): Promise<DriveItem | null> {
    const res = await this.call(`${(await this.base()).root}:/${enc(segments)}`);
    if (res.status === 404) return null;
    return this.json<DriveItem>(res, "Look up item");
  }

  /* ---------- StorageAdapter ---------- */

  async ensureFolder(folder: FolderPath): Promise<void> {
    await this.folderId(folder);
  }

  /** One lookup for the parent, then one request per child (a few at a time) — each OneDrive call takes ~0.75s. */
  async ensureFolders(parent: FolderPath, names: string[]): Promise<void> {
    const parentId = await this.folderId(parent);
    const { items } = await this.base();
    const todo = names.filter((n) => !this.folders.has([...parent, n].join("/")));
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (n) => {
          const res = await this.call(`${items}/${parentId}/children`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cleanSegment(n), folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
          });
          if (res.status !== 409) await this.json<DriveItem>(res, `Create folder ${n}`); // 409 = already there
          this.folders.add([...parent, n].join("/"));
        }),
      );
    }
  }

  /** Creates any missing folders along the path and returns the last one's id. */
  private async folderId(folder: FolderPath): Promise<string> {
    const b = await this.base();
    const existing = await this.itemByPath(folder);
    if (existing) {
      this.folders.add(folder.join("/"));
      return existing.id;
    }
    let parentId = b.rootId;
    for (let i = 0; i < folder.length; i++) {
      const res = await this.call(`${b.items}/${parentId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanSegment(folder[i]), folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      });
      if (res.status === 409) {
        parentId = (await this.itemByPath(folder.slice(0, i + 1)))!.id; // already there
      } else {
        parentId = (await this.json<DriveItem>(res, `Create folder ${folder[i]}`)).id;
      }
    }
    this.folders.add(folder.join("/"));
    return parentId;
  }

  async exists(folder: FolderPath, name: string): Promise<boolean> {
    return (await this.itemByPath([...folder, name])) !== null;
  }

  async save(folder: FolderPath, name: string, data: Buffer): Promise<StoredItem> {
    if (!this.folders.has(folder.join("/"))) await this.ensureFolder(folder);
    const { root } = await this.base();
    const path = enc([...folder, name]);
    let item: DriveItem;
    if (data.length <= SIMPLE_MAX) {
      const res = await this.call(`${root}:/${path}:/content?@microsoft.graph.conflictBehavior=fail`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(data),
      });
      item = await this.json<DriveItem>(res, `Upload ${name}`);
    } else {
      // Resumable upload session for larger files
      const session = await this.json<{ uploadUrl: string }>(
        await this.call(`${root}:/${path}:/createUploadSession`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
        }),
        `Start upload of ${name}`,
      );
      let res: Response | undefined;
      for (let start = 0; start < data.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, data.length);
        // The upload URL is pre-authorised: no Authorization header
        res = await this.call(
          session.uploadUrl,
          {
            method: "PUT",
            headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${data.length}` },
            body: new Uint8Array(data.subarray(start, end)),
          },
          { auth: false },
        );
        if (!res.ok && res.status !== 202) await this.json(res, `Upload ${name} (part)`);
      }
      item = await this.json<DriveItem>(res!, `Finish upload of ${name}`);
    }
    return { itemId: item.id, name: item.name, webUrl: item.webUrl };
  }

  async move(itemId: string, toFolder: FolderPath, newName: string): Promise<StoredItem> {
    const parentId = await this.folderId(toFolder);
    const res = await this.call(`${(await this.base()).items}/${encodeURIComponent(itemId)}?@microsoft.graph.conflictBehavior=fail`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentReference: { id: parentId }, name: cleanSegment(newName) }),
    });
    const item = await this.json<DriveItem>(res, `Move to ${toFolder.at(-1)}`);
    return { itemId: item.id, name: item.name, webUrl: item.webUrl };
  }

  async read(itemId: string): Promise<Buffer> {
    const res = await this.call(`${(await this.base()).items}/${encodeURIComponent(itemId)}/content`);
    if (!res.ok) await this.json(res, "Download file");
    return Buffer.from(await res.arrayBuffer());
  }

  async list(folder: FolderPath): Promise<StoredItem[]> {
    const res = await this.call(`${(await this.base()).root}:/${enc(folder)}:/children?$select=id,name,webUrl,file&$top=999`);
    if (res.status === 404) return [];
    const body = await this.json<{ value: (DriveItem & { file?: unknown })[] }>(res, "List folder");
    return body.value.filter((i) => i.file).map((i) => ({ itemId: i.id, name: i.name, webUrl: i.webUrl }));
  }

  /** Used by `npm run onedrive:check`. */
  async whoAmI() {
    if (this.cfg.mode === "personal") return this.json<{ id: string; name: string; webUrl: string }>(await this.call("/me/drive/special/approot"), "Open the app folder");
    const res = await this.call(`/drives/${await this.drive()}`);
    return this.json<{ id: string; name: string; webUrl: string }>(res, "Read library");
  }

  async remove(itemId: string) {
    const res = await this.call(`${(await this.base()).items}/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) await this.json(res, "Delete test item");
  }

  async deleteFolder(folder: FolderPath) {
    const item = await this.itemByPath(folder);
    if (!item) return; // already gone — no-op
    const res = await this.call(`${(await this.base()).items}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) await this.json(res, `Delete folder ${folder.at(-1)}`);
    // Evict any cached folder paths under this tree
    const prefix = folder.join("/");
    for (const k of this.folders) if (k === prefix || k.startsWith(prefix + "/")) this.folders.delete(k);
  }
}

/** Personal OneDrive (Microsoft 365 Personal/Family): STORAGE_PROVIDER="onedrive", sign-in saved by npm run setup:onedrive. */
export function personalFromEnv(): GraphStorage {
  const clientId = process.env.GRAPH_CLIENT_ID;
  if (!clientId) throw new Error("STORAGE_PROVIDER=onedrive needs GRAPH_CLIENT_ID — run npm run setup:onedrive");
  return new GraphStorage({ mode: "personal", clientId, tokens: dbRefreshStore });
}

export function graphFromEnv(): GraphStorage {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SITE_URL, GRAPH_LIBRARY } = process.env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_SITE_URL)
    throw new Error("STORAGE_PROVIDER=graph needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_SITE_URL");
  return new GraphStorage({ tenantId: GRAPH_TENANT_ID, clientId: GRAPH_CLIENT_ID, clientSecret: GRAPH_CLIENT_SECRET, siteUrl: GRAPH_SITE_URL, library: GRAPH_LIBRARY || undefined });
}
