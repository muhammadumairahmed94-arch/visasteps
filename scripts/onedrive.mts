/**
 * Microsoft 365 / SharePoint connection for the portal.
 *   npm run setup:onedrive    asks for the app details, tests them, saves to .env
 *   npm run onedrive:check    tests the saved details (creates and deletes a small test file)
 *   npm run onedrive:folders  creates the folder tree for every client with an account
 * See docs/onedrive-setup.md for the Microsoft side.
 */
import { GraphAuthLost, GraphError, GraphStorage, PERSONAL_SCOPE, type GraphConfig, type RefreshStore } from "../lib/adapters/graph";
import { askHidden, askUntil, saveEnv } from "./prompt.mjs";

const mode = process.argv[2] ?? "check";
const ok = (s: string) => console.log(`  ✓ ${s}`);

/** Plain-English hints for the errors people actually hit. */
function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/AADSTS70002|AADSTS7000218|public client/i.test(m)) return `${m}\n  → In the app registration: Authentication → "Allow public client flows" → Yes → Save.`;
  if (/AADSTS50059|AADSTS9002331|unauthorized_client/i.test(m)) return `${m}\n  → The app must allow personal Microsoft accounts. Check "Supported account types" in the guide, step P2.`;
  if (e instanceof GraphAuthLost) return `${m}\n  → Run npm run setup:onedrive again and sign in.`;
  if (/AADSTS7000215|invalid_client/i.test(m)) return `${m}\n  → The client secret is wrong. Copy the secret's VALUE (not its ID) from Entra → Certificates & secrets.`;
  if (/AADSTS700016|AADSTS90002|not found in the directory/i.test(m)) return `${m}\n  → The tenant ID or client ID is wrong. Copy both from the app's Overview page in Entra.`;
  if (e instanceof GraphError && e.status === 403) return `${m}\n  → The app has no access to this site yet. Do step 5 in docs/onedrive-setup.md (grant "write" on the site), and check admin consent was granted (step 4).`;
  if (e instanceof GraphError && e.status === 401) return `${m}\n  → Admin consent missing. In Entra → API permissions press "Grant admin consent".`;
  if (e instanceof GraphError && e.status === 404) return `${m}\n  → Site not found. Check the site address, e.g. https://uhalegal.sharepoint.com/sites/ClientFiles`;
  return m;
}

async function test(cfg: GraphConfig) {
  const store = new GraphStorage(cfg);
  console.log("\nChecking with Microsoft…");
  const lib = await store.whoAmI();
  ok(`Signed in and found the library: ${lib.webUrl}`);
  const folder = ["_portal-check", `check-${Date.now()}`];
  await store.ensureFolder(folder);
  ok("Created a test folder");
  const saved = await store.save(folder, "test.txt", Buffer.from("UHA Legal client portal connection test"));
  ok("Uploaded a test file");
  if ((await store.read(saved.itemId)).toString() !== "UHA Legal client portal connection test") throw new Error("Read-back did not match");
  ok("Read it back");
  const moved = await store.move(saved.itemId, [...folder, "_Old versions"], "test.txt");
  ok("Moved it into _Old versions");
  await store.remove(moved.itemId);
  ok("Deleted the test file (the empty _portal-check folder can be deleted by hand)");
}

/** One-time sign-in for a personal OneDrive: the user types a short code at microsoft.com/link. */
async function deviceSignIn(clientId: string) {
  const base = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
  const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });
  const start = (await (await fetch(`${base}/devicecode`, form({ client_id: clientId, scope: PERSONAL_SCOPE }))).json()) as {
    device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number; error_description?: string;
  };
  if (!start.device_code) throw new Error(start.error_description ?? "Microsoft did not start the sign-in");
  console.log(`\n  1. On this computer or your phone, open:  ${start.verification_uri}`);
  console.log(`  2. Enter this code:                      ${start.user_code}`);
  console.log("  3. Sign in with the Microsoft account that has the Microsoft 365 plan, and press Accept.\n");
  console.log("  Waiting for you to finish signing in…");
  const deadline = Date.now() + (start.expires_in ?? 900) * 1000;
  let wait = (start.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    const t = (await (await fetch(`${base}/token`, form({ client_id: clientId, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code }))).json()) as {
      refresh_token?: string; id_token?: string; error?: string; error_description?: string;
    };
    if (t.refresh_token) {
      const claims = t.id_token ? JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()) : {};
      return { refreshToken: t.refresh_token, account: String(claims.preferred_username ?? claims.email ?? "Microsoft account") };
    }
    if (t.error === "authorization_pending") continue;
    if (t.error === "slow_down") { wait += 5000; continue; }
    throw new Error(t.error_description ?? t.error ?? "Sign-in failed");
  }
  throw new Error("The sign-in code expired. Run the command again.");
}

const fromEnv = (): GraphConfig => {
  if (process.env.STORAGE_PROVIDER === "onedrive") {
    if (!process.env.GRAPH_CLIENT_ID) {
      console.error("No Microsoft details saved yet. Run: npm run setup:onedrive");
      process.exit(1);
    }
    return { mode: "personal", clientId: process.env.GRAPH_CLIENT_ID, tokens: dbStore! };
  }
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SITE_URL, GRAPH_LIBRARY } = process.env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_SITE_URL) {
    console.error("No Microsoft details saved yet. Run: npm run setup:onedrive");
    process.exit(1);
  }
  return { tenantId: GRAPH_TENANT_ID, clientId: GRAPH_CLIENT_ID, clientSecret: GRAPH_CLIENT_SECRET, siteUrl: GRAPH_SITE_URL, library: GRAPH_LIBRARY || undefined };
};

const guid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

let dbStore: RefreshStore | undefined;
if (process.env.STORAGE_PROVIDER === "onedrive" && mode !== "setup") dbStore = (await import("../lib/onedrive-connection")).dbRefreshStore;

try {
  const plan = mode === "setup" ? await askUntil("Which Microsoft 365 plan?  P = Personal/Family (OneDrive)   B = Business (SharePoint)  [P/B]: ", (v: string) => /^[pb]$/i.test(v), "Type P or B.") : "";
  if (mode === "setup" && /^p$/i.test(plan)) {
    console.log("\nPersonal OneDrive setup (see docs/onedrive-setup.md, part P). Ctrl+C stops without saving.\n");
    const clientId = await askUntil("Application (client) ID: ", guid, "Paste the Application (client) ID from the app's Overview page — it looks like 1a2b3c4d-....");
    const signed = await deviceSignIn(clientId);
    ok(`Signed in as ${signed.account}`);
    let latest = signed.refreshToken; // Microsoft rotates it on each use; keep the newest
    const memory: RefreshStore = { load: async () => latest, save: async (t) => void (latest = t), lost: async () => {} };
    await test({ mode: "personal", clientId, tokens: memory });
    const { connect } = await import("../lib/onedrive-connection");
    await connect(latest, signed.account);
    saveEnv({ STORAGE_PROVIDER: "onedrive", GRAPH_CLIENT_ID: clientId });
    console.log(`\nSaved. Files will go to ${signed.account}'s OneDrive → Apps → (the app's name) → Clients, once the portal restarts`);
    console.log("(Ctrl+C in its tab, then npm run dev). Then run: npm run onedrive:folders");
    const { db } = await import("../lib/db");
    await db.$disconnect();
  } else if (mode === "setup") {
    console.log("\nSharePoint setup — 4 questions (see docs/onedrive-setup.md, part B). Ctrl+C stops without saving.\n");
    const tenantId = await askUntil("1/4  Directory (tenant) ID: ", guid, "Paste the Directory (tenant) ID from the app's Overview page — it looks like 1a2b3c4d-....");
    const clientId = await askUntil("2/4  Application (client) ID: ", guid, "Paste the Application (client) ID from the app's Overview page.");
    let clientSecret = "";
    while (!clientSecret) clientSecret = await askHidden("3/4  Client secret VALUE (nothing shows as you type): ");
    const siteUrl = await askUntil(
      "4/4  SharePoint site address (e.g. https://uhalegal.sharepoint.com/sites/ClientFiles): ",
      (v: string) => /^https:\/\/[a-z0-9-]+\.sharepoint\.com\/sites\/[^/\s]+\/?$/i.test(v),
      "Use the site's address, like https://uhalegal.sharepoint.com/sites/ClientFiles",
    );
    const cfg = { tenantId, clientId, clientSecret, siteUrl: siteUrl.replace(/\/$/, "") };
    await test(cfg);
    saveEnv({ STORAGE_PROVIDER: "graph", GRAPH_TENANT_ID: tenantId, GRAPH_CLIENT_ID: clientId, GRAPH_CLIENT_SECRET: clientSecret, GRAPH_SITE_URL: cfg.siteUrl });
    console.log("\nSaved. New uploads will go to SharePoint once the portal restarts (Ctrl+C in its tab, then npm run dev).");
    console.log("Then run: npm run onedrive:folders   to create folders for clients who already have an account.");
  } else if (mode === "check") {
    await test(fromEnv());
    console.log("\nAll good.");
    if (dbStore) (await import("../lib/db")).db.$disconnect();
  } else if (mode === "folders") {
    const { db } = await import("../lib/db");
    const { createCaseFolders } = await import("../lib/cases");
    if (process.env.STORAGE_PROVIDER !== "graph" && process.env.STORAGE_PROVIDER !== "onedrive") {
      console.error("Connect Microsoft first: npm run setup:onedrive");
      process.exit(1);
    }
    const clients = await db.client.findMany({ where: { accountCreatedAt: { not: null } } });
    for (const c of clients) {
      await createCaseFolders(c, c.routeId);
      ok(`${c.caseRef} ${c.lastName}_${c.firstName}`);
    }
    console.log(`\nFolders ready for ${clients.length} client${clients.length === 1 ? "" : "s"}.`);
    await db.$disconnect();
  } else {
    console.error(`Unknown mode "${mode}". Use setup, check or folders.`);
    process.exit(1);
  }
} catch (e) {
  console.error(`\n  ✗ ${explain(e)}\n\nNothing was saved.`);
  process.exit(1);
}
