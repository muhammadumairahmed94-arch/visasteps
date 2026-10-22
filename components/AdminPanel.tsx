"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminView } from "@/lib/admin";
import { Tabs, api } from "./ui";

type Tab = "team" | "firm" | "checklists";
type User = AdminView["users"][number];
type Route = AdminView["routes"][number];
type Item = Route["items"][number];

const form = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

/** Firm owner's screen: team, firm details, document checklists per visa route. */
export default function AdminPanel({ tab, setTab, onBack, toast }: { tab: Tab; setTab: (t: Tab) => void; onBack: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<AdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<AdminView>("/api/admin").then((r) => (r.ok ? setData(r.data) : setError(r.error))), []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs an admin action, shows its message, reloads. Returns the result, or null on error (shown as a toast). */
  const run = useCallback(
    async (url: string, json: unknown) => {
      const r = await api<Result>(url, { method: "POST", json });
      if (!r.ok) {
        toast(r.error);
        return null;
      }
      if (r.data.message) toast(r.data.message);
      await load();
      return r.data;
    },
    [load, toast],
  );

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← Clients</button>
      <section className="hello">
        <p className="eyebrow">Admin</p>
        <h1 data-focus tabIndex={-1}>Firm settings</h1>
      </section>
      <Tabs<Tab> label="Admin sections" tabs={[["team", "Team"], ["firm", "Firm"], ["checklists", "Checklists"]]} value={tab} onChange={setTab} />
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack">
        {error && <p className="error" role="alert">{error}</p>}
        {!data ? (
          !error && <p className="muted" role="status">Loading…</p>
        ) : tab === "team" ? (
          <Team data={data} run={run} />
        ) : tab === "firm" ? (
          <Firm data={data} run={run} />
        ) : (
          <Checklists data={data} run={run} />
        )}
      </div>
    </>
  );
}

type Result = { message?: string; id?: string };
type Run = (url: string, json: unknown) => Promise<Result | null>;

/* ---------- Team ---------- */

function Team({ data, run }: { data: AdminView; run: Run }) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = (u: User) =>
    u.disabled ? "Removed" : !u.passwordSet ? "Invite sent" : u.twoFactor ? (u.role === "ADMIN" ? "Admin" : "Active") : "2FA not set up yet";

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    setBusy(true);
    if (await run("/api/admin/users", form(e))) el.reset();
    setBusy(false);
  }

  return (
    <>
      <div className="list">
        {data.users.map((u) => (
          <div key={u.id}>
            <button type="button" className="row" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>
              <span className="t">
                {u.name}
                {u.id === data.me && <span className="muted"> (you)</span>}
                <br />
                <span className="muted" style={{ overflowWrap: "anywhere" }}>{u.email} · {u.clients} client{u.clients === 1 ? "" : "s"}</span>
              </span>
              <span className={`pill ${u.disabled ? "" : "p-ok"}`}>{status(u)}</span>
              <span className="chev" aria-hidden="true">{open === u.id ? "⌄" : "›"}</span>
            </button>
            {open === u.id && <UserActions u={u} data={data} run={run} />}
          </div>
        ))}
      </div>
      <form className="detail card" onSubmit={add}>
        <h2>Add a caseworker</h2>
        <div className="field">
          <label htmlFor="u-name">Name</label>
          <input id="u-name" name="name" className="input" required autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="u-email">Email</label>
          <input id="u-email" name="email" type="email" className="input" required autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="u-role">Role</label>
          <select id="u-role" name="role" className="input" defaultValue="CASEWORKER">
            <option value="CASEWORKER">Caseworker — sees their own clients</option>
            <option value="ADMIN">Admin — sees all clients and these settings</option>
          </select>
        </div>
        <button className="big" disabled={busy}>{busy ? "Adding…" : "Add and send invite"}</button>
        <p className="muted">They get an email to choose a password, then set up two-step sign-in.</p>
      </form>
    </>
  );
}

function UserActions({ u, data, run }: { u: User; data: AdminView; run: Run }) {
  const others = data.users.filter((x) => x.id !== u.id && !x.disabled);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const me = u.id === data.me;
  const act = (body: object) => run(`/api/admin/users/${u.id}`, body);
  return (
    <div className="detail sub">
      {u.disabled ? (
        <button type="button" className="ghost" onClick={() => act({ action: "enable" })}>Restore access</button>
      ) : (
        <>
          <button type="button" className="ghost" onClick={() => act({ action: "sendLink" })}>
            {u.passwordSet ? "Send password reset link" : "Send invite again"}
          </button>
          {u.twoFactor && (
            <button type="button" className="ghost" onClick={() => confirm(`Reset two-step sign-in for ${u.name}? They will scan a new QR code at their next sign-in.`) && act({ action: "reset2fa" })}>
              Reset two-step sign-in (lost phone)
            </button>
          )}
          {!me && (
            <button type="button" className="ghost" onClick={() => act({ action: "role", role: u.role === "ADMIN" ? "CASEWORKER" : "ADMIN" })}>
              {u.role === "ADMIN" ? "Make caseworker (remove admin)" : "Make admin"}
            </button>
          )}
          {!me && (
            <div className="field">
              {u.clients > 0 && (
                <>
                  <label htmlFor={`to-${u.id}`}>Move their {u.clients} client{u.clients === 1 ? "" : "s"} to</label>
                  <select id={`to-${u.id}`} className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </>
              )}
              <button type="button" className="ghost danger" onClick={() => confirm(`Remove ${u.name}? They will be signed out and unable to sign in. Their history is kept.`) && act({ action: "disable", reassignTo: to })}>
                Remove from team
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Firm ---------- */

function Firm({ data, run }: { data: AdminView; run: Run }) {
  const [busy, setBusy] = useState(false);
  const s = data.storage;
  const where =
    s.provider === "onedrive"
      ? s.account
        ? `${s.account}'s OneDrive → Apps → UHA Legal Client Portal`
        : "OneDrive (not connected yet)"
      : s.provider === "graph"
        ? "SharePoint site (Microsoft 365 Business)"
        : "This computer only (local test storage)";
  return (
    <>
      <form
        className="detail"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run("/api/admin/firm", form(e));
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="f-name">Firm name</label>
          <input id="f-name" name="name" className="input" defaultValue={data.firm.name} required />
        </div>
        <div className="field">
          <label htmlFor="f-phone">Phone shown to clients</label>
          <input id="f-phone" name="phone" className="input" defaultValue={data.firm.phone} required />
        </div>
        <div className="field">
          <label htmlFor="f-wa">WhatsApp number</label>
          <input id="f-wa" name="whatsapp" className="input" inputMode="numeric" defaultValue={data.firm.whatsapp} aria-describedby="f-wa-hint" />
          <p id="f-wa-hint" className="hint">Digits only with country code, e.g. 923341161664. Leave empty to hide the WhatsApp button.</p>
        </div>
        <button className="big" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </form>
      <section className="detail">
        <h2>Document storage</h2>
        <p>{where}</p>
        {s.status === "reconnect" && <p className="error">Microsoft needs a fresh sign-in. On the portal computer run: npm run setup:onedrive</p>}
        <p className="muted">To connect or change the Microsoft account, follow docs/onedrive-setup.md on the computer running the portal.</p>
      </section>
    </>
  );
}

/* ---------- Checklists ---------- */

function Checklists({ data, run }: { data: AdminView; run: Run }) {
  const [routeId, setRouteId] = useState(data.routes[0]?.id ?? "");
  const route = data.routes.find((r) => r.id === routeId) ?? data.routes[0];
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="field">
        <label htmlFor="route">Visa route</label>
        <select id="route" className="input" value={route?.id ?? ""} onChange={(e) => setRouteId(e.target.value)}>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.clients} client{r.clients === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </div>

      {route && (
        <>
          {route.folders.map((folder) => {
            const items = route.items.filter((i) => i.folder === folder);
            return (
              <section key={folder} className="detail">
                <h2>{items[0]?.groupLabel ?? folder}</h2>
                <p className="muted fn">{folder}</p>
                <div className="list">
                  {items.map((it, i) => (
                    <ItemRow key={it.id} item={it} first={i === 0} last={i === items.length - 1} run={run} />
                  ))}
                </div>
              </section>
            );
          })}
          {adding ? (
            <AddItem route={route} run={run} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className="big" onClick={() => setAdding(true)}>Add a document to {route.name}</button>
          )}
        </>
      )}
      <AddRoute data={data} run={run} onAdded={(id) => setRouteId(id)} />
    </>
  );
}

function ItemRow({ item, first, last, run }: { item: Item; first: boolean; last: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const act = (body: object) => run(`/api/admin/items/${item.id}`, body);
  if (editing)
    return (
      <form
        className="detail sub"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = form(e);
          if (await act({ title: f.title, why: f.why, howToGet: f.howToGet, exampleImage: f.exampleImage, dateWindow: f.dateWindow, required: f.required === "on" })) setEditing(false);
        }}
      >
        <div className="field">
          <label htmlFor={`t-${item.id}`}>Document name</label>
          <input id={`t-${item.id}`} name="title" className="input" defaultValue={item.title} required />
        </div>
        <div className="field">
          <label htmlFor={`w-${item.id}`}>What it is (one sentence for the client)</label>
          <textarea id={`w-${item.id}`} name="why" rows={2} defaultValue={item.why} required />
        </div>
        <div className="field">
          <label htmlFor={`dw-${item.id}`}>Date window</label>
          <input id={`dw-${item.id}`} name="dateWindow" className="input" defaultValue={item.dateWindow} placeholder='e.g. "last 6 months" or "last 28 days"' />
          <p className="hint">Leave empty if no date rule applies. Exact dates are shown to the client using the planned submission date.</p>
        </div>
        <div className="field">
          <label htmlFor={`ei-${item.id}`}>Example image filename</label>
          <input id={`ei-${item.id}`} name="exampleImage" className="input" defaultValue={item.exampleImage} placeholder="e.g. bank-statement.png" />
          <p className="hint">File must be in the public/samples/ folder on the server.</p>
        </div>
        <div className="field">
          <label htmlFor={`hg-${item.id}`}>How to get this (optional)</label>
          <textarea id={`hg-${item.id}`} name="howToGet" rows={3} defaultValue={item.howToGet} placeholder="Plain-English steps, e.g. how to download statements from a banking app." />
        </div>
        <label className="check">
          <input type="checkbox" name="required" defaultChecked={item.required} /> Required (unticked = optional)
        </label>
        <div className="btns">
          <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button className="big">Save</button>
        </div>
      </form>
    );
  return (
    <div className="row item-row">
      <span className="t">
        {item.title}
        {!item.required && <span className="muted"> (optional)</span>}
        <br />
        <span className="muted">{item.why}</span>
      </span>
      <span className="item-actions">
        <button type="button" className="mini" aria-label={`Move ${item.title} up`} disabled={first} onClick={() => act({ move: "up" })}>↑</button>
        <button type="button" className="mini" aria-label={`Move ${item.title} down`} disabled={last} onClick={() => act({ move: "down" })}>↓</button>
        <button type="button" className="mini" onClick={() => setEditing(true)}>Edit</button>
        <button
          type="button"
          className="mini danger"
          onClick={() => confirm(`Remove "${item.title}" from this route? Clients who already sent it keep it; others stop seeing it.`) && act({ remove: true })}
        >
          Remove
        </button>
      </span>
    </div>
  );
}

function AddItem({ route, run, onDone }: { route: Route; run: Run; onDone: () => void }) {
  const [folder, setFolder] = useState(route.folders[0] ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="detail card"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = form(e);
        setBusy(true);
        const ok = await run(`/api/admin/routes/${route.id}/items`, {
          title: f.title,
          why: f.why,
          howToGet: f.howToGet || undefined,
          exampleImage: f.exampleImage || undefined,
          dateWindow: f.dateWindow || undefined,
          required: f.required === "on",
          folder: folder === "__new" ? "" : folder,
          newFolder: f.newFolder,
          addToExisting: f.addToExisting === "on",
        });
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <h2>Add a document</h2>
      <div className="field">
        <label htmlFor="n-title">Document name</label>
        <input id="n-title" name="title" className="input" placeholder="e.g. Council tax bill" required />
      </div>
      <div className="field">
        <label htmlFor="n-why">What it is (one sentence for the client)</label>
        <textarea id="n-why" name="why" rows={2} placeholder="e.g. A recent bill showing the UK address." required />
      </div>
      <div className="field">
        <label htmlFor="n-dw">Date window</label>
        <input id="n-dw" name="dateWindow" className="input" placeholder='e.g. "last 6 months" or "last 28 days"' />
        <p className="hint">Leave empty if no date rule applies.</p>
      </div>
      <div className="field">
        <label htmlFor="n-ei">Example image filename</label>
        <input id="n-ei" name="exampleImage" className="input" placeholder="e.g. bank-statement.png" />
        <p className="hint">File must be in the public/samples/ folder on the server.</p>
      </div>
      <div className="field">
        <label htmlFor="n-hg">How to get this (optional)</label>
        <textarea id="n-hg" name="howToGet" rows={3} placeholder="Plain-English steps, e.g. how to download statements from a banking app." />
      </div>
      <div className="field">
        <label htmlFor="n-folder">Section (and OneDrive folder)</label>
        <select id="n-folder" className="input" value={folder} onChange={(e) => setFolder(e.target.value)}>
          {route.folders.map((f) => (
            <option key={f} value={f}>{route.items.find((i) => i.folder === f)?.groupLabel ?? f} — {f}</option>
          ))}
          <option value="__new">New section…</option>
        </select>
      </div>
      {folder === "__new" && (
        <div className="field">
          <label htmlFor="n-new">New section name</label>
          <input id="n-new" name="newFolder" className="input" placeholder="e.g. Tax" required />
        </div>
      )}
      <label className="check">
        <input type="checkbox" name="required" defaultChecked /> Required
      </label>
      {route.clients > 0 && (
        <label className="check">
          <input type="checkbox" name="addToExisting" defaultChecked /> Also ask the {route.clients} existing client{route.clients === 1 ? "" : "s"} on this route
        </label>
      )}
      <div className="btns">
        <button type="button" className="ghost" onClick={onDone}>Cancel</button>
        <button className="big" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      </div>
    </form>
  );
}

function AddRoute({ data, run, onAdded }: { data: AdminView; run: Run; onAdded: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="ghost" onClick={() => setOpen(true)}>
        Add a visa route (e.g. Skilled Worker, Student, ILR)
      </button>
    );
  return (
    <form
      className="detail card"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = form(e);
        const added = await run("/api/admin/routes", { name: f.name, copyFrom: f.copyFrom || undefined });
        if (added?.id) {
          onAdded(added.id);
          setOpen(false);
        }
      }}
    >
      <h2>Add a visa route</h2>
      <div className="field">
        <label htmlFor="r-name">Route name</label>
        <input id="r-name" name="name" className="input" placeholder="e.g. Skilled Worker visa" required />
      </div>
      <div className="field">
        <label htmlFor="r-copy">Start from</label>
        <select id="r-copy" name="copyFrom" className="input" defaultValue="">
          <option value="">An empty checklist</option>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>A copy of {r.name}</option>
          ))}
        </select>
      </div>
      <div className="btns">
        <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="big">Add route</button>
      </div>
    </form>
  );
}
