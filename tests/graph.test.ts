import { describe, expect, it } from "vitest";
import { GraphAuthLost, GraphStorage, type RefreshStore } from "../lib/adapters/graph";
import { StorageConflict, saveUnique } from "../lib/adapters/storage";

/** A small in-memory imitation of the Graph endpoints the adapter uses. */
function fakeGraph({ throttleFirst = false } = {}) {
  type Item = { id: string; name: string; parent: string; folder: boolean; data?: Buffer };
  const items = new Map<string, Item>([
    ["root", { id: "root", name: "", parent: "", folder: true }],
    ["app", { id: "app", name: "UHA Legal Client Portal", parent: "", folder: true }], // personal OneDrive app folder
  ]);
  let nextId = 1;
  const stats = { tokens: 0, refreshes: 0, uploadAuthHeaders: 0, throttled: 0, sessions: new Map<string, { path: string; parts: Buffer[]; total: number }>() };
  const childByName = (parent: string, name: string) => [...items.values()].find((i) => i.parent === parent && i.name === name);
  const byPath = (path: string, base = "root") => {
    let cur = items.get(base)!;
    for (const seg of path.split("/").filter(Boolean).map(decodeURIComponent)) {
      const next = childByName(cur.id, seg);
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  };
  const view = (i: Item) => ({ id: i.id, name: i.name, webUrl: `https://uha.sharepoint.com/f/${i.id}`, ...(i.folder ? { folder: {} } : {}) });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const create = (parent: string, name: string, folder: boolean, data?: Buffer) => {
    if (childByName(parent, name)) return json(409, { error: { code: "nameAlreadyExists" } });
    const item = { id: `i${nextId++}`, name, parent, folder, data };
    items.set(item.id, item);
    return json(201, view(item));
  };

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const p = url.pathname.replace("/v1.0", "");
    const auth = new Headers(init.headers).get("authorization");

    if (url.hostname === "login.microsoftonline.com" && url.pathname.startsWith("/consumers")) {
      const form = new URLSearchParams(String(init.body));
      if (form.get("refresh_token") === "dead") return json(400, { error: "invalid_grant", error_description: "AADSTS70000: expired" });
      stats.refreshes++;
      return json(200, { access_token: "tok", refresh_token: `rt-${stats.refreshes}`, expires_in: 3600 });
    }
    if (url.hostname === "login.microsoftonline.com") {
      stats.tokens++;
      return json(200, { access_token: "tok", expires_in: 3600 });
    }
    if (url.hostname === "upload.test") {
      if (auth) stats.uploadAuthHeaders++;
      const s = stats.sessions.get(p)!;
      s.parts.push(Buffer.from(init.body as Uint8Array));
      const got = s.parts.reduce((a, b) => a + b.length, 0);
      if (got < s.total) return json(202, { nextExpectedRanges: [`${got}-`] });
      const [folder, name] = [s.path.split("/").slice(0, -1).join("/"), decodeURIComponent(s.path.split("/").at(-1)!)];
      return create(byPath(folder)!.id, name, false, Buffer.concat(s.parts));
    }
    if (auth !== "Bearer tok") return json(401, {});
    if (throttleFirst && stats.throttled === 0) {
      stats.throttled++;
      return new Response("", { status: 429, headers: { "Retry-After": "0" } });
    }
    if (p === "/sites/uha.sharepoint.com:/sites/ClientFiles") return json(200, { id: "site1" });
    if (p === "/sites/site1/drives") return json(200, { value: [{ id: "d1", name: "Documents" }] });
    if (p === "/drives/d1") return json(200, { id: "d1", name: "Documents", webUrl: "https://uha.sharepoint.com/Docs" });

    if (p === "/me/drive/special/approot") return json(200, view(items.get("app")!));
    const base = p.startsWith("/me/drive/special/approot") ? "app" : "root";
    const P = p.replace(/^\/me\/drive\/special\/approot/, "/drives/d1/root").replace(/^\/me\/drive\/items/, "/drives/d1/items");
    let m;
    if ((m = P.match(/^\/drives\/d1\/root:\/(.+):\/content$/)) && method === "PUT") {
      const parts = m[1].split("/");
      return create(byPath(parts.slice(0, -1).join("/"), base)!.id, decodeURIComponent(parts.at(-1)!), false, Buffer.from(init.body as Uint8Array));
    }
    if ((m = P.match(/^\/drives\/d1\/root:\/(.+):\/createUploadSession$/))) {
      const id = `/session/${nextId++}`;
      stats.sessions.set(id, { path: m[1], parts: [], total: 6 * 1024 * 1024 });
      return json(200, { uploadUrl: `https://upload.test${id}` });
    }
    if ((m = P.match(/^\/drives\/d1\/root:\/(.+)$/))) {
      const item = byPath(m[1], base);
      return item ? json(200, view(item)) : json(404, { error: { code: "itemNotFound" } });
    }
    if ((m = P.match(/^\/drives\/d1\/items\/([^/]+)\/children$/)) && method === "POST") {
      const b = JSON.parse(String(init.body));
      return create(m[1], b.name, true);
    }
    if ((m = P.match(/^\/drives\/d1\/items\/([^/]+)\/content$/))) return new Response(new Uint8Array(items.get(m[1])!.data!));
    if ((m = P.match(/^\/drives\/d1\/items\/([^/]+)$/)) && method === "PATCH") {
      const b = JSON.parse(String(init.body));
      const item = items.get(m[1])!;
      if (childByName(b.parentReference.id, b.name)) return json(409, { error: { code: "nameAlreadyExists" } });
      Object.assign(item, { parent: b.parentReference.id, name: b.name });
      return json(200, view(item));
    }
    return json(400, { error: { code: "unexpected", message: `${method} ${p}` } });
  }) as typeof fetch;

  return { fetchImpl, stats, byPath };
}

const cfg = { tenantId: "t", clientId: "c", clientSecret: "s", siteUrl: "https://uha.sharepoint.com/sites/ClientFiles" };
const folder = ["Clients", "Khan_Amina_IM-2041", "03 Finances"];

describe("Microsoft Graph storage (simulated)", () => {
  it("creates nested folders, saves, reads back and links to SharePoint", async () => {
    const g = fakeGraph();
    const store = new GraphStorage(cfg, g.fetchImpl);
    const saved = await store.save(folder, "Khan_Payslip_2026-10-18.pdf", Buffer.from("%PDF-1.7 demo"));
    expect(g.byPath("Clients/Khan_Amina_IM-2041/03%20Finances/Khan_Payslip_2026-10-18.pdf")).toBeTruthy();
    expect(saved.webUrl).toMatch(/^https:\/\/uha\.sharepoint\.com/);
    expect((await store.read(saved.itemId)).toString()).toBe("%PDF-1.7 demo");
    expect(await store.exists(folder, "Khan_Payslip_2026-10-18.pdf")).toBe(true);
    expect(await store.exists(folder, "nope.pdf")).toBe(false);
    expect(g.stats.tokens).toBe(1); // sign-in reused
  });

  it("never overwrites: a clash raises StorageConflict and saveUnique picks _2", async () => {
    const store = new GraphStorage(cfg, fakeGraph().fetchImpl);
    await store.save(folder, "Khan_Payslip.pdf", Buffer.from("a"));
    await expect(store.save(folder, "Khan_Payslip.pdf", Buffer.from("b"))).rejects.toBeInstanceOf(StorageConflict);
    expect((await saveUnique(store, folder, "Khan_Payslip.pdf", Buffer.from("b"))).name).toBe("Khan_Payslip_2.pdf");
  });

  it("uploads large files in 320 KiB-aligned chunks without sending the token to the upload URL", async () => {
    const g = fakeGraph();
    const store = new GraphStorage(cfg, g.fetchImpl);
    const big = Buffer.alloc(6 * 1024 * 1024, 7);
    const saved = await store.save(folder, "Khan_Bank-statement_2026-10-18.pdf", big);
    expect((await store.read(saved.itemId)).equals(big)).toBe(true);
    expect(g.stats.uploadAuthHeaders).toBe(0);
  });

  it("moves to _Old versions, creating the folder", async () => {
    const g = fakeGraph();
    const store = new GraphStorage(cfg, g.fetchImpl);
    const saved = await store.save(folder, "Khan_Payslip_2026-10-12.pdf", Buffer.from("old"));
    await store.move(saved.itemId, [...folder, "_Old versions"], "Khan_Payslip_2026-10-12.pdf");
    expect(g.byPath("Clients/Khan_Amina_IM-2041/03%20Finances/_Old%20versions/Khan_Payslip_2026-10-12.pdf")).toBeTruthy();
    expect(g.byPath("Clients/Khan_Amina_IM-2041/03%20Finances/Khan_Payslip_2026-10-12.pdf")).toBeUndefined();
  });

  it("waits and retries when Microsoft throttles (429)", async () => {
    const g = fakeGraph({ throttleFirst: true });
    const store = new GraphStorage(cfg, g.fetchImpl);
    await store.ensureFolder(folder);
    expect(g.stats.throttled).toBe(1);
    expect(g.byPath("Clients/Khan_Amina_IM-2041/03%20Finances")).toBeTruthy();
  });
});

describe("Personal OneDrive app folder (simulated)", () => {
  const memoryStore = (start: string) => {
    const state = { token: start, lost: "" };
    const store: RefreshStore = { load: async () => state.token, save: async (t) => void (state.token = t), lost: async (r) => void (state.lost = r) };
    return { state, store };
  };

  it("saves into OneDrive/Apps/<app>/Clients/… and keeps the newest refresh token", async () => {
    const g = fakeGraph();
    const { state, store } = memoryStore("rt-0");
    const od = new GraphStorage({ mode: "personal", clientId: "c", tokens: store }, g.fetchImpl);
    const saved = await od.save(folder, "Khan_Passport_2026-10-18.pdf", Buffer.from("%PDF passport"));
    expect(g.byPath("Clients/Khan_Amina_IM-2041/03%20Finances/Khan_Passport_2026-10-18.pdf", "app")).toBeTruthy();
    expect(g.byPath("Clients", "root")).toBeUndefined(); // nothing outside the app folder
    expect((await od.read(saved.itemId)).toString()).toBe("%PDF passport");
    expect(state.token).toBe("rt-1"); // rotated token saved
    expect(g.stats.refreshes).toBe(1); // and reused while valid
  });

  it("reports a lost sign-in so caseworkers can be warned", async () => {
    const { state, store } = memoryStore("dead");
    const od = new GraphStorage({ mode: "personal", clientId: "c", tokens: store }, fakeGraph().fetchImpl);
    await expect(od.ensureFolder(folder)).rejects.toBeInstanceOf(GraphAuthLost);
    expect(state.lost).toMatch(/invalid_grant/);
  });
});
