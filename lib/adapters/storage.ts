import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { graphFromEnv, personalFromEnv } from "./graph";

/** Folder paths are arrays of segments, e.g. ["Clients", "Khan_Amina_IM-2041", "01 Identity"]. */
export type FolderPath = string[];

export interface StoredItem {
  itemId: string;
  name: string;
  /** Link that opens the file in SharePoint (Graph only). */
  webUrl?: string;
}

/** A file with that name already exists in the folder. */
export class StorageConflict extends Error {}

export interface StorageAdapter {
  ensureFolder(folder: FolderPath): Promise<void>;
  /** Creates several folders inside one parent (missing ones only). */
  ensureFolders(parent: FolderPath, names: string[]): Promise<void>;
  exists(folder: FolderPath, name: string): Promise<boolean>;
  save(folder: FolderPath, name: string, data: Buffer): Promise<StoredItem>;
  move(itemId: string, toFolder: FolderPath, newName: string): Promise<StoredItem>;
  read(itemId: string): Promise<Buffer>;
  /** Files directly inside a folder (used to prune old backups). Missing folder = empty list. */
  list(folder: FolderPath): Promise<StoredItem[]>;
  remove(itemId: string): Promise<void>;
}

/** Strips characters OneDrive / SharePoint reject in names. */
export function cleanSegment(s: string): string {
  const out = s.replace(/["*:<>?/\\|#%]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!out) throw new Error("Empty path segment");
  return out;
}

/** Writes to ./local-storage, mirroring the folder tree that will exist in OneDrive. */
class LocalStorage implements StorageAdapter {
  constructor(private root: string) {}

  private resolve(segments: string[]): string {
    const p = path.resolve(this.root, ...segments.map(cleanSegment));
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error("Path escapes storage root");
    return p;
  }

  private id(abs: string) {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  async ensureFolder(folder: FolderPath) {
    await mkdir(this.resolve(folder), { recursive: true });
  }

  async ensureFolders(parent: FolderPath, names: string[]) {
    for (const n of names) await this.ensureFolder([...parent, n]);
  }

  async exists(folder: FolderPath, name: string) {
    try {
      await stat(this.resolve([...folder, name]));
      return true;
    } catch {
      return false;
    }
  }

  async save(folder: FolderPath, name: string, data: Buffer) {
    simulateOutage();
    await this.ensureFolder(folder);
    const abs = this.resolve([...folder, name]);
    try {
      await writeFile(abs, data, { flag: "wx" }); // never overwrite
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new StorageConflict(name);
      throw e;
    }
    return { itemId: this.id(abs), name };
  }

  async move(itemId: string, toFolder: FolderPath, newName: string) {
    simulateOutage();
    await this.ensureFolder(toFolder);
    const from = this.resolve(itemId.split("/"));
    const to = this.resolve([...toFolder, newName]);
    await rename(from, to);
    return { itemId: this.id(to), name: newName };
  }

  async read(itemId: string) {
    return readFile(this.resolve(itemId.split("/")));
  }

  async list(folder: FolderPath) {
    try {
      const entries = await readdir(this.resolve(folder), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => ({ itemId: this.id(this.resolve([...folder, e.name])), name: e.name }));
    } catch {
      return [];
    }
  }

  async remove(itemId: string) {
    await rm(this.resolve(itemId.split("/")), { force: true });
  }
}

/** Local testing of the retry queue: STORAGE_FAKE_OUTAGE=1 makes the fake storage refuse saves and moves. */
function simulateOutage() {
  if (process.env.STORAGE_FAKE_OUTAGE === "1") throw new Error("Simulated storage outage (STORAGE_FAKE_OUTAGE=1)");
}

let graph: StorageAdapter | undefined;

export function storage(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "fake";
  if (provider === "fake") return new LocalStorage(path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR ?? "./local-storage"));
  if (provider === "graph") return (graph ??= graphFromEnv()); // Microsoft 365 Business: SharePoint site
  if (provider === "onedrive") return (graph ??= personalFromEnv()); // Microsoft 365 Personal: OneDrive app folder
  throw new Error(`Unknown STORAGE_PROVIDER "${provider}"`);
}

/** Uploads under a unique name: tries `name`, then name_2, name_3… if the folder already has one. */
export async function saveUnique(store: StorageAdapter, folder: FolderPath, name: string, data: Buffer): Promise<StoredItem> {
  for (let k = 1; k <= 50; k++) {
    const candidate = k === 1 ? name : name.replace(/(\.\w+)?$/, `_${k}$1`);
    if (await store.exists(folder, candidate)) continue;
    try {
      return await store.save(folder, candidate, data);
    } catch (e) {
      if (e instanceof StorageConflict) continue; // someone else took the name in between
      throw e;
    }
  }
  throw new Error(`No free file name for ${name}`);
}
