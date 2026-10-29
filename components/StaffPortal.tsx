"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { StaffCaseView } from "@/lib/documents";
import StaffSignIn from "./StaffSignIn";
import AdminPanel from "./AdminPanel";
import GuidancePanel from "./GuidancePanel";
import RequirementsPanel from "./RequirementsPanel";
import MessageThread from "./MessageThread";
import AnalyseTab from "./AnalyseTab";
import GuidanceCheckTab from "./GuidanceCheckTab";
import type { AnalysisView } from "@/lib/case-analysis";
import { STAFF_LABEL, Page, Row, StatusPill, Tabs, api, useHashView, useToast, type Status } from "./ui";

type Tab = "review" | "missing" | "folders" | "client" | "messages" | "analyse" | "guidance-check";
type AdminTab = "team" | "firm" | "checklists" | "deletion";
type View = { screen: "list" } | { screen: "new" } | { screen: "admin"; tab: AdminTab } | { screen: "guidance" } | { screen: "requirements" } | { screen: "case"; id: string; tab: Tab; group?: string; doc?: string };
type Home = {
  me: { id: string; name: string; role: "ADMIN" | "CASEWORKER" };
  cases: { id: string; name: string; accountCreated: boolean; closed: boolean; caseRef: string; route: string; toReview: number; missing: number; unread: number }[];
  routes: { id: string; name: string }[];
  caseworkers: { id: string; name: string }[];
  storageWarning: string | null;
};
type Doc = StaffCaseView["groups"][number]["docs"][number] & { status: Status };

const TABS: Tab[] = ["review", "missing", "folders", "client", "messages", "analyse", "guidance-check"];
const parse = (h: string): View => {
  const [a, id, tab, kind, x] = h.split("/");
  if (a === "new") return { screen: "new" };
  if (a === "admin") return { screen: "admin", tab: (["team", "firm", "checklists"].includes(id) ? id : "team") as AdminTab };
  if (a === "guidance") return { screen: "guidance" };
  if (a === "requirements") return { screen: "requirements" };
  if (a !== "c" || !id) return { screen: "list" };
  const t = TABS.includes(tab as Tab) ? (tab as Tab) : "review";
  return { screen: "case", id, tab: t, group: kind === "g" ? x : undefined, doc: kind === "d" ? x : undefined };
};
const format = (v: View) =>
  v.screen === "case"
    ? `c/${v.id}/${v.tab}${v.doc ? `/d/${v.doc}` : v.group ? `/g/${encodeURIComponent(v.group)}` : ""}`
    : v.screen === "new"
      ? "new"
      : v.screen === "admin"
        ? `admin/${v.tab}`
        : v.screen === "guidance"
          ? "guidance"
          : v.screen === "requirements"
            ? "requirements"
            : "";

export default function StaffPortal() {
  const [state, setState] = useState<"loading" | "signedOut" | "in">("loading");
  const [home, setHome] = useState<Home | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [view, go] = useHashView(parse, format);
  const [toast, toastNode] = useToast();

  const loadHome = useCallback(
    () =>
      api<Home>("/api/staff/cases").then((r) => {
        if (r.ok) {
          setHome(r.data);
          setState("in");
        } else setState("signedOut");
      }),
    [],
  );

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  const signOut = (
    <>
      {state === "in" && (
        <button
          type="button"
          className="who"
          onClick={async () => {
            await api("/api/auth/staff/signout", { method: "POST" });
            setState("signedOut");
            setHome(null);
          }}
        >
          Sign out
        </button>
      )}
    </>
  );

  if (state === "loading")
    return (
      <Page label="Caseworker">
        <p className="muted" role="status">Loading…</p>
      </Page>
    );
  if (state === "signedOut" || !home)
    return (
      <Page label="Caseworker">
        <StaffSignIn onDone={loadHome} />
      </Page>
    );

  let content: React.ReactNode;
  if (view.screen === "new")
    content = (
      <NewClient
        home={home}
        onCancel={() => go({ screen: "list" })}
        onCreated={async (id, ref, warning) => {
          await loadHome();
          go({ screen: "case", id, tab: "client" });
          toast(warning ?? `${ref} created. Invite sent by email.`);
        }}
      />
    );
  else if (view.screen === "admin" && home.me.role === "ADMIN")
    content = <AdminPanel tab={view.tab} setTab={(t) => go({ screen: "admin", tab: t })} onBack={() => (go({ screen: "list" }), void loadHome())} toast={toast} />;
  else if (view.screen === "guidance")
    content = <GuidancePanel onBack={() => go({ screen: "list" })} toast={toast} />;
  else if (view.screen === "requirements")
    content = <RequirementsPanel onBack={() => go({ screen: "list" })} toast={toast} />;
  else if (view.screen === "case") content = <CaseView view={view} go={go} toast={toast} onChange={loadHome} admin={home.me.role === "ADMIN"} />;
  else {
    const listed = home.cases.filter((c) => c.closed === showClosed);
    const closedCount = home.cases.filter((c) => c.closed).length;
    content = (
      <>
        <section className="hello">
          <h1 data-focus tabIndex={-1}>{showClosed ? "Closed cases" : "Clients"}</h1>
          <p>{showClosed ? `${closedCount} closed` : `${home.cases.filter((c) => !c.closed).reduce((a, c) => a + c.toReview, 0)} to review`}</p>
        </section>
        <button type="button" className="big" onClick={() => go({ screen: "new" })}>New client</button>
        <button type="button" className="ghost" onClick={() => go({ screen: "guidance" })}>Guidance library</button>
        <button type="button" className="ghost" onClick={() => go({ screen: "requirements" })}>Requirements</button>
        {home.me.role === "ADMIN" && (
          <button type="button" className="ghost" onClick={() => go({ screen: "admin", tab: "team" })}>Admin: team, firm details, checklists</button>
        )}
        {listed.length ? (
          <div className="list">
            {listed.map((c) => (
              <button type="button" key={c.id} className="row" onClick={() => go({ screen: "case", id: c.id, tab: "review" })}>
                <span className="t">
                  {c.name}
                  <br />
                  <span className="muted">{c.caseRef} · {c.route}</span>
                </span>
                <span className={`pill ${c.toReview ? "p-sent" : c.unread && !c.closed && c.accountCreated ? "p-msg" : ""}`}>
                  {c.closed ? "Closed" : !c.accountCreated ? "Invite sent" : c.toReview ? `${c.toReview} to review` : c.missing ? `${c.missing} missing` : c.unread ? `${c.unread} message${c.unread === 1 ? "" : "s"}` : "All in"}
                </span>
                <span className="chev" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{showClosed ? "No closed cases." : "No clients yet."}</p>
        )}
        {(closedCount > 0 || showClosed) && (
          <button type="button" className="link" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "← Back to open cases" : `Closed cases (${closedCount})`}
          </button>
        )}
      </>
    );
  }

  return (
    <Page label="Caseworker" right={signOut}>
      {home.storageWarning && (
        <p className="error" role="status">
          {home.storageWarning}
        </p>
      )}
      {content}
      {toastNode}
    </Page>
  );
}

/* ---------- new client ---------- */

function NewClient({ home, onCancel, onCreated }: { home: Home; onCancel: () => void; onCreated: (id: string, ref: string, warning?: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api<{ id: string; caseRef: string; warning?: string }>("/api/staff/cases", { method: "POST", json: Object.fromEntries(new FormData(e.currentTarget)) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onCreated(r.data.id, r.data.caseRef, r.data.warning);
  }
  const field = (id: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} className="input" required {...props} />
    </div>
  );
  return (
    <>
      <button type="button" className="back" onClick={onCancel}>← All clients</button>
      <h2 data-focus tabIndex={-1}>New client</h2>
      <form className="detail" onSubmit={submit}>
        {field("email", "Client's email", { type: "email", autoComplete: "off" })}
        <div className="field">
          <label htmlFor="routeId">Visa route</label>
          <select id="routeId" name="routeId" className="input" defaultValue="" required>
            <option value="" disabled>Choose a route</option>
            {home.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="caseworkerId">Caseworker</label>
          <select id="caseworkerId" name="caseworkerId" className="input" defaultValue={home.me.id} required>
            {home.caseworkers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="big" disabled={busy}>{busy ? "Creating…" : "Create and send invite"}</button>
        <p className="muted">We email the client a link to create their account. They add their own name and choose a password. The link works for 7 days.</p>
      </form>
    </>
  );
}

/* ---------- one case ---------- */

function CaseView({
  view,
  go,
  toast,
  onChange,
  admin,
}: {
  view: Extract<View, { screen: "case" }>;
  go: (v: View) => void;
  toast: (m: string) => void;
  onChange: () => void;
  admin: boolean;
}) {
  const [data, setData] = useState<StaffCaseView | null>(null);
  const [missing, setMissing] = useState(false);
  const [unread, setUnread] = useState(0);
  const [analyseView, setAnalyseView] = useState<AnalysisView | null>(null);
  const load = useCallback(
    () =>
      api<StaffCaseView>(`/api/staff/cases/${view.id}`).then((r) => {
        if (r.ok) {
          setData(r.data);
          setUnread(r.data.client.unreadMessages);
        } else setMissing(true);
      }),
    [view.id],
  );
  const loadAnalyse = useCallback(
    () =>
      api<AnalysisView>(`/api/staff/cases/${view.id}/analysis`).then((r) => {
        if (r.ok) setAnalyseView(r.data);
      }),
    [view.id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (view.tab === "analyse") void loadAnalyse();
  }, [view.tab, loadAnalyse]);

  if (missing)
    return (
      <>
        <button type="button" className="back" onClick={() => go({ screen: "list" })}>← All clients</button>
        <p className="muted">We could not find this client.</p>
      </>
    );
  if (!data) return <p className="muted" role="status">Loading…</p>;

  const docs = data.groups.flatMap((g) => g.docs) as Doc[];
  const review = docs.filter((d) => d.status === "SENT");
  const missingDocs = docs.filter((d) => d.required && d.status === "NEED");
  const unsaved = docs.reduce((a, d) => a + d.files.filter((f) => f.storage !== "SAVED").length, 0);
  const to = (v: Partial<Extract<View, { screen: "case" }>>) => go({ screen: "case", id: view.id, tab: view.tab, ...v });
  const rows = (ds: Doc[]) => (
    <div className="list">
      {ds.map((d) => (
        <Row key={d.id} status={d.status} labels={STAFF_LABEL} onClick={() => to({ doc: d.id, group: undefined })}>
          {d.title}
          {!d.required && <span className="muted"> (optional)</span>}
        </Row>
      ))}
    </div>
  );

  let body: React.ReactNode;
  const doc = view.doc ? docs.find((d) => d.id === view.doc) : undefined;
  if (doc) {
    const group = data.groups.find((g) => g.docs.some((d) => d.id === doc.id))!;
    body = (
      <DocReview
        doc={doc}
        folder={group.id}
        hasSponsor={!!data.client.sponsor}
        onBack={() => history.back()}
        onRefresh={() => void load()}
        onDone={async (msg) => {
          await load();
          onChange();
          history.back();
          toast(msg);
        }}
      />
    );
  } else if (view.tab === "review") body = review.length ? rows(review) : <p className="muted">Nothing to review right now.</p>;
  else if (view.tab === "missing")
    body = missingDocs.length ? (
      <div className="list">
        {missingDocs.map((d) => (
          <Row key={d.id} status={d.status} labels={STAFF_LABEL} onClick={() => to({ doc: d.id, group: undefined })}>
            <span>
              {d.title}
              {!d.required && <span className="muted"> (optional)</span>}
              {d.missingAt && <><br /><span className="muted">Client said: {d.missingReason}</span></>}
            </span>
          </Row>
        ))}
      </div>
    ) : (
      <p className="muted">Nothing missing.</p>
    );
  else if (view.tab === "folders") {
    const g = view.group ? data.groups.find((x) => x.id === view.group) : undefined;
    body = g ? (
      <>
        <button type="button" className="back" onClick={() => to({ group: undefined })}>← All folders</button>
        <h2 data-focus tabIndex={-1}>{g.id}</h2>
        {rows(g.docs as Doc[])}
      </>
    ) : (
      <div className="tiles">
        {data.groups.map((g) => {
          const n = g.docs.reduce((a, d) => a + d.files.length, 0);
          return (
            <button type="button" key={g.id} className="tile" onClick={() => to({ group: g.id })}>
              <b>{g.id}</b>
              <small>{n} file{n === 1 ? "" : "s"}</small>
            </button>
          );
        })}
      </div>
    );
  } else if (view.tab === "messages")
    body = (
      <MessageThread
        endpoint={`/api/staff/messages/${view.id}`}
        senderKind="STAFF"
        onRead={() => setUnread(0)}
      />
    );
  else if (view.tab === "analyse")
    body = analyseView ? (
      <AnalyseTab
        clientId={view.id}
        view={analyseView}
        onRefresh={() => void loadAnalyse()}
        toast={toast}
      />
    ) : (
      <p className="muted" role="status">Loading…</p>
    );
  else if (view.tab === "guidance-check")
    body = (
      <GuidanceCheckTab
        clientId={view.id}
        aiEnabled={data.aiEnabled}
        isAdmin={admin}
        toast={toast}
      />
    );
  else
    body = (
      <div className="detail">
        <h2 data-focus tabIndex={-1}>{data.client.name}</h2>
        <p className="why">{data.client.caseRef} · {data.client.route} · Stage 3: documents</p>
        {data.client.closedAt && <p className="note"><b>Case closed</b> on {data.client.closedAt}. The client cannot sign in. Records and OneDrive files are kept.</p>}
        {!data.client.closedAt && !data.client.accountCreated && <p className="note">Invite created. Waiting for the client to create their account.</p>}
        <p>
          {data.client.mobile && (
            <>
              {data.client.mobile}
              <br />
            </>
          )}
          <span style={{ overflowWrap: "anywhere" }}>{data.client.email}</span>
          <br />
          <span className="muted">Caseworker: {data.client.caseworker}</span>
        </p>
        <p className="muted">
          {data.client.storageRoot ? (
            <>
              Files are saved in OneDrive under <span className="fn">{data.client.storageRoot}</span>
            </>
          ) : (
            "Folders are created when the client sets up their account."
          )}
        </p>
        <SubmissionDate clientId={view.id} value={data.client.plannedSubmissionDate} toast={toast} onChange={() => void load()} />
        <CaseStageSelect clientId={view.id} value={data.client.caseStage} toast={toast} onChange={() => void load()} />
        {!data.client.closedAt && (
          <>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                const r = await api<{ message: string }>(`/api/staff/cases/${view.id}/invite`, { method: "POST" });
                toast(r.ok ? r.data.message : r.error);
              }}
            >
              {data.client.accountCreated ? "Send password reset link" : "Send invite again"}
            </button>
            <ShareLink clientId={view.id} accountCreated={data.client.accountCreated} toast={toast} />
            <Reminders clientId={view.id} summary={data.client.reminders} onChange={() => void load()} toast={toast} />
          </>
        )}
        <SponsorCard clientId={view.id} sponsor={data.client.sponsor} closed={!!data.client.closedAt} toast={toast} onChange={() => void load()} />
        {admin && (
          <LegalHold
            clientId={view.id}
            legalHold={data.client.legalHold}
            legalHoldReason={data.client.legalHoldReason}
            toast={toast}
            onChange={() => void load()}
          />
        )}
        <CaseActions
          clientId={view.id}
          caseRef={data.client.caseRef}
          closed={!!data.client.closedAt}
          admin={admin}
          toast={toast}
          onChange={async () => {
            await load();
            onChange();
          }}
          onDeleted={() => {
            onChange();
            go({ screen: "list" });
          }}
        />
        <Activity clientId={view.id} />
      </div>
    );

  return (
    <>
      <button type="button" className="back" onClick={() => go({ screen: "list" })}>← All clients</button>
      <section className="hello">
        <p className="eyebrow">{data.client.caseRef} · {data.client.route}</p>
        <h1 style={{ overflowWrap: "anywhere" }}>{data.client.name}</h1>
        <p>
          {data.client.closedAt && <b>Closed · </b>}
          {review.length} to review · {missingDocs.length} missing
          {unsaved > 0 && <b> · {unsaved} file{unsaved === 1 ? "" : "s"} not yet in OneDrive</b>}
        </p>
      </section>
      <Tabs<Tab>
        label="Case sections"
        tabs={[
          ["review", "To review"],
          ["missing", "Missing"],
          ["folders", "Folders"],
          ["client", "Client"],
          ["messages", unread > 0 ? `Messages (${unread})` : "Messages"],
          ...(data.aiEnabled ? [["analyse", "Analyse"] as [Tab, string]] : []),
          ...(data.aiEnabled ? [["guidance-check", "Guidance check"] as [Tab, string]] : []),
        ]}
        value={view.tab}
        onChange={(t) => go({ screen: "case", id: view.id, tab: t })}
      />
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${view.tab}`} className="stack">
        {body}
      </div>
    </>
  );
}

function DocReview({ doc, folder, hasSponsor, onBack, onDone, onRefresh }: { doc: Doc; folder: string; hasSponsor: boolean; onBack: () => void; onDone: (msg: string) => void; onRefresh: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(action: "approve" | "redo") {
    if (action === "redo" && !note.trim()) return setError("Write a short note first");
    setBusy(true);
    setError(null);
    const r = await api<{ warning?: string }>(`/api/staff/documents/${doc.id}/review`, { method: "POST", json: { action, note } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(r.data.warning ?? (action === "approve" ? "Approved" : "Sent to the client by email"));
  }

  async function reassign(to: "CLIENT" | "SPONSOR") {
    setBusy(true);
    setError(null);
    const r = await api<{ ok: boolean }>(`/api/staff/documents/${doc.id}/assign`, { method: "PATCH", json: { assignedTo: to } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onRefresh();
  }

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← Back</button>
      <div className="detail">
        <h2 data-focus tabIndex={-1}>{doc.title}</h2>
        <StatusPill status={doc.status} labels={STAFF_LABEL} />
        {hasSponsor && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Assigned to: <b>{doc.assignedTo === "SPONSOR" ? "Partner" : "Client"}</b>
            {" · "}
            <button type="button" className="link" disabled={busy} onClick={() => reassign(doc.assignedTo === "SPONSOR" ? "CLIENT" : "SPONSOR")}>
              Reassign to {doc.assignedTo === "SPONSOR" ? "client" : "partner"}
            </button>
          </p>
        )}
        {doc.status === "REDO" && doc.note && <div className="note"><b>You asked:</b> {doc.note}</div>}
        {doc.missingAt && (
          <div className="note">
            <b>Client said they cannot find this document</b>
            <p>{doc.missingReason}</p>
            <RespondMissing docId={doc.id} onDone={(msg) => onDone(msg)} />
          </div>
        )}
        {doc.files.length ? (
          doc.files.map((f) => <FileRow key={f.id} file={f} folder={folder} onSaved={onRefresh} />)
        ) : (
          <p className="muted">The client has not sent this yet.</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {doc.status === "SENT" &&
          (asking ? (
            <>
              <label htmlFor="note" className="sr-only">Note to the client</label>
              <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell the client what to fix, in plain words" autoFocus />
              <div className="btns">
                <button type="button" className="ghost" disabled={busy} onClick={() => (setAsking(false), setError(null))}>Cancel</button>
                <button type="button" className="big" disabled={busy} onClick={() => send("redo")}>Send to client</button>
              </div>
            </>
          ) : (
            <div className="btns">
              <button type="button" className="ghost" disabled={busy} onClick={() => setAsking(true)}>Ask to redo</button>
              <button type="button" className="big" disabled={busy} onClick={() => send("approve")}>Approve</button>
            </div>
          ))}
      </div>
    </>
  );
}

function RespondMissing({ docId, onDone }: { docId: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await api<{ message: string }>(`/api/staff/documents/${docId}/missing`, { method: "POST", json: { note } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(r.data.message);
  }

  if (!open)
    return <button type="button" className="ghost" onClick={() => setOpen(true)}>Respond to client</button>;

  return (
    <>
      <label htmlFor={`rmiss-${docId}`} className="sr-only">Note to client (optional)</label>
      <textarea id={`rmiss-${docId}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: write a note to the client" autoFocus />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="btns">
        <button type="button" className="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="big" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Reply and clear flag"}</button>
      </div>
    </>
  );
}

type ActivityRow = { id: string; at: string; who: string; what: string };

/** Audit trail for one client, newest first (from the audit log). */
function Activity({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  useEffect(() => {
    api<ActivityRow[]>(`/api/staff/cases/${clientId}/activity`).then((r) => setRows(r.ok ? r.data : []));
  }, [clientId]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="detail" aria-labelledby="activity-h">
      <h2 id="activity-h">Activity</h2>
      {!rows ? (
        <p className="muted" role="status">Loading…</p>
      ) : rows.length ? (
        <ol className="activity">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="what">{r.what}</span>
              <span className="muted">
                {r.who} · <time dateTime={r.at}>{when(r.at)}</time>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No activity yet.</p>
      )}
    </section>
  );
}

type FileInfo = Doc["files"][number];

/** One stored file: open it, see whether it reached OneDrive, retry if it did not. */
function FileRow({ file, folder, onSaved }: { file: FileInfo; folder: string; onSaved: () => void }) {
  const [status, setStatus] = useState(file.storage);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    setMsg(null);
    const r = await api<{ storage: typeof status; error: string | null }>(`/api/staff/files/${file.id}/retry`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    setStatus(r.data.storage);
    if (r.data.storage === "SAVED") onSaved();
    setMsg(r.data.storage === "SAVED" ? "Saved to OneDrive." : `Still not saved: ${r.data.error ?? "Microsoft did not respond"}`);
  }
  return (
    <div className="file">
      <a className="fn" href={`/api/staff/files/${file.id}`} target="_blank" rel="noopener">
        {file.storedName}
      </a>
      <div className="muted">
        Uploaded as “{file.orig}” on {file.date}
        {status === "SAVED" && <> · saved to {folder}</>}
      </div>
      {status === "SAVED" && file.webUrl && (
        <a className="link" href={file.webUrl} target="_blank" rel="noopener">Open in SharePoint</a>
      )}
      {status === "PENDING" && <p className="pending">Not in OneDrive yet. Retrying automatically.</p>}
      {status === "FAILED" && <p className="error">Not saved to OneDrive. Automatic retries have stopped.</p>}
      {status !== "SAVED" && (
        <button type="button" className="ghost" onClick={retry} disabled={busy}>{busy ? "Retrying…" : "Retry now"}</button>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}

/** Automatic reminder status and the pause switch for one client. */
function Reminders({ clientId, summary, onChange, toast }: { clientId: string; summary: { paused: boolean; text: string }; onChange: () => void; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const r = await api(`/api/staff/cases/${clientId}/reminders`, { method: "POST", json: { paused: !summary.paused } });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    toast(summary.paused ? "Reminders resumed" : "Reminders paused");
    onChange();
  }
  return (
    <section className="detail" aria-labelledby="reminders-h">
      <h2 id="reminders-h">Reminders</h2>
      <p className="muted">
        {summary.text} Missing documents: every 3 days, up to 5 emails. Re-uploads: once after 2 days. Sent 9am–7pm UK time.
      </p>
      <button type="button" className="ghost" onClick={toggle} disabled={busy}>
        {summary.paused ? "Resume reminders" : "Pause reminders"}
      </button>
    </section>
  );
}

/** Send the client their link by WhatsApp or text — for when email is not getting through. */
function ShareLink({ clientId, accountCreated, toast }: { clientId: string; accountCreated: boolean; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ message: string; mobile: string | null } | null>(null);

  async function make() {
    setBusy(true);
    const r = await api<{ message: string; mobile: string | null }>(`/api/staff/cases/${clientId}/link`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    setShared(r.data);
    try {
      await navigator.clipboard.writeText(r.data.message);
      toast("Copied. Paste it into WhatsApp or a text message.");
    } catch {
      toast("Link ready below. Select and copy it.");
    }
  }

  const wa = shared && `https://wa.me/${shared.mobile ? shared.mobile.replace(/\D/g, "") : ""}?text=${encodeURIComponent(shared.message)}`;
  return (
    <section className="detail" aria-labelledby="share-h">
      <h2 id="share-h">{accountCreated ? "Password reset link" : "Invite link"}</h2>
      <p className="muted">
        {accountCreated
          ? "If the client cannot sign in, send them a link to choose a new password (works once, for 1 hour)."
          : "Send the client their link to create an account, e.g. by WhatsApp. Making a new link cancels older ones."}
      </p>
      <button type="button" className="ghost" onClick={make} disabled={busy}>
        {busy ? "Making link…" : accountCreated ? "Copy password reset link" : "Copy invite link"}
      </button>
      {shared && (
        <>
          <a className="big" href={wa!} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
            Send by WhatsApp
          </a>
          <textarea readOnly rows={4} value={shared.message} aria-label="Message with link" onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </section>
  );
}

/** Legal hold: prevent a closed case from being auto-deleted under the retention policy (admin only). */
function LegalHold({ clientId, legalHold, legalHoldReason, toast, onChange }: {
  clientId: string; legalHold: boolean; legalHoldReason: string | null; toast: (m: string) => void; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(legalHoldReason ?? "");

  async function toggle() {
    const placing = !legalHold;
    if (placing && !reason.trim()) { toast("Enter a reason for the legal hold."); return; }
    if (!placing && !window.confirm(`Remove the legal hold from this case? It will be eligible for deletion under the retention policy again.`)) return;
    setBusy(true);
    const r = await api<{ message: string }>(`/api/staff/cases/${clientId}/hold`, { method: "POST", json: { hold: placing, reason } });
    setBusy(false);
    toast(r.ok ? r.data.message : r.error);
    if (r.ok) onChange();
  }

  return (
    <section className="detail" aria-labelledby="hold-h">
      <h2 id="hold-h">Legal hold</h2>
      {legalHold ? (
        <>
          <p className="note">This case is on legal hold and will not be deleted automatically.</p>
          {legalHoldReason && <p className="muted">Reason: {legalHoldReason}</p>}
          <button type="button" className="ghost" disabled={busy} onClick={toggle}>Remove legal hold</button>
        </>
      ) : (
        <>
          <p className="muted">Place a hold to prevent this case being deleted when it reaches its retention due date.</p>
          <div className="field">
            <label htmlFor="hold-reason">Reason for hold</label>
            <input id="hold-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Active litigation" />
          </div>
          <button type="button" className="ghost" disabled={busy || !reason.trim()} onClick={toggle}>Place legal hold</button>
        </>
      )}
    </section>
  );
}

/** Close or reopen the case; admins can also delete the client's portal record (OneDrive files are kept). */
function CaseActions({ clientId, caseRef, closed, admin, toast, onChange, onDeleted }: {
  clientId: string; caseRef: string; closed: boolean; admin: boolean; toast: (m: string) => void; onChange: () => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");

  async function post(path: string, json: unknown) {
    setBusy(true);
    const r = await api<{ message: string }>(`/api/staff/cases/${clientId}/${path}`, { method: "POST", json });
    setBusy(false);
    toast(r.ok ? r.data.message : r.error);
    return r.ok;
  }

  return (
    <section className="detail" aria-labelledby="case-h">
      <h2 id="case-h">Case</h2>
      {closed ? (
        <button type="button" className="ghost" disabled={busy} onClick={async () => (await post("close", { closed: false })) && onChange()}>
          Reopen case
        </button>
      ) : (
        <>
          <p className="muted">Close the case when the work is finished. The client can no longer sign in and reminders stop. Everything is kept and the case can be reopened.</p>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={async () => confirmClose(caseRef) && (await post("close", { closed: true })) && onChange()}
          >
            Close case
          </button>
        </>
      )}
      {admin &&
        (deleting ? (
          <form
            className="detail sub"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post("delete", { confirm })) onDeleted();
            }}
          >
            <p className="error">
              This permanently deletes the client&apos;s portal account, document statuses, notes and links. It cannot be undone. Their documents stay in OneDrive (delete them there when your retention period ends).
            </p>
            <div className="field">
              <label htmlFor="del-confirm">Type {caseRef} to confirm</label>
              <input id="del-confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </div>
            <div className="btns">
              <button type="button" className="ghost" onClick={() => (setDeleting(false), setConfirm(""))}>Cancel</button>
              <button className="big danger-fill" disabled={busy || confirm.trim().toUpperCase() !== caseRef.toUpperCase()}>Delete permanently</button>
            </div>
          </form>
        ) : (
          <button type="button" className="link danger" onClick={() => setDeleting(true)}>
            Delete client permanently (admins)
          </button>
        ))}
    </section>
  );
}

const confirmClose = (ref: string) => window.confirm(`Close ${ref}? The client will be signed out and can no longer sign in. You can reopen it later.`);

const STAGE_OPTIONS = [
  { value: "DOCUMENTS", label: "Sending documents" },
  { value: "CHECKING",  label: "Lawyer checking" },
  { value: "READY",     label: "Ready to submit" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "DECISION",  label: "Decision" },
];

function CaseStageSelect({ clientId, value, toast, onChange }: { clientId: string; value: string; toast: (m: string) => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(stage: string) {
    setBusy(true);
    const r = await api<{ message: string }>(`/api/staff/cases/${clientId}`, { method: "PATCH", json: { caseStage: stage } });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    toast("Stage updated");
    onChange();
  }
  return (
    <section className="detail" aria-labelledby="stage-h">
      <h2 id="stage-h">Case stage</h2>
      <p className="muted">Shown to the client on their Visa tab as &ldquo;Where is my case?&rdquo;</p>
      <div className="field">
        <label htmlFor={`stage-${clientId}`} className="sr-only">Case stage</label>
        <select id={`stage-${clientId}`} className="input" value={value} disabled={busy} onChange={(e) => save(e.target.value)}>
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

/** Planned submission date — used to turn date windows into exact dates on the client portal. */
function SubmissionDate({ clientId, value, toast, onChange }: { clientId: string; value: string | null; toast: (m: string) => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(date: string | null) {
    setBusy(true);
    const r = await api<{ message: string }>(`/api/staff/cases/${clientId}`, { method: "PATCH", json: { plannedSubmissionDate: date || null } });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    toast(date ? "Planned submission date saved" : "Planned submission date cleared");
    onChange();
  }
  return (
    <section className="detail" aria-labelledby="subdate-h">
      <h2 id="subdate-h">Planned submission date</h2>
      <p className="muted">Used to turn date windows (&ldquo;last 6 months&rdquo;) into exact dates on the client portal. If not set, today&apos;s date is used instead.</p>
      <div className="field">
        <label htmlFor={`sd-${clientId}`} className="sr-only">Planned submission date</label>
        <input
          id={`sd-${clientId}`}
          type="date"
          className="input"
          defaultValue={value ?? ""}
          aria-label="Planned submission date"
          disabled={busy}
          onBlur={(e) => { if (e.target.value !== (value ?? "")) save(e.target.value || null); }}
        />
      </div>
    </section>
  );
}

type SponsorInfo = { id: string; label: string; email: string; visibleToClient: boolean };

function SponsorCard({ clientId, sponsor, closed, toast, onChange }: { clientId: string; sponsor: SponsorInfo | null; closed: boolean; toast: (m: string) => void; onChange: () => void }) {
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState(sponsor?.email ?? "");
  const [label, setLabel] = useState(sponsor?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api<{ ok: boolean }>(`/api/staff/cases/${clientId}/sponsor`, { method: "POST", json: { email, label } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setInviting(false);
    onChange();
    toast("Partner invite sent");
  }

  async function cancel() {
    if (!confirm("Cancel the partner account? They will no longer be able to upload documents.")) return;
    setBusy(true);
    const r = await api(`/api/staff/cases/${clientId}/sponsor`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    onChange();
    toast("Partner account cancelled");
  }

  async function toggleVisible(v: boolean) {
    setBusy(true);
    const r = await api(`/api/staff/cases/${clientId}/sponsor`, { method: "PATCH", json: { visibleToClient: v } });
    setBusy(false);
    if (!r.ok) return toast(r.error);
    onChange();
    toast(v ? "Partner documents now visible to client" : "Partner documents hidden from client");
  }

  return (
    <section className="detail" aria-labelledby="sponsor-h">
      <h2 id="sponsor-h">Partner account</h2>
      {sponsor ? (
        <>
          <p>
            <b>{sponsor.label}</b>
            <br />
            <span style={{ overflowWrap: "anywhere" }}>{sponsor.email}</span>
          </p>
          <p className="muted">
            Partner documents {sponsor.visibleToClient ? "are visible to the main client" : "are hidden from the main client"}.
            {" "}
            <button type="button" className="link" disabled={busy} onClick={() => toggleVisible(!sponsor.visibleToClient)}>
              {sponsor.visibleToClient ? "Hide from client" : "Make visible to client"}
            </button>
          </p>
          {!closed && (
            <>
              <button type="button" className="ghost" disabled={busy} onClick={() => { setInviting(true); setEmail(sponsor.email); setLabel(sponsor.label); }}>
                Re-invite partner
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={cancel}>
                Cancel partner account
              </button>
            </>
          )}
        </>
      ) : (
        !closed && !inviting && (
          <button type="button" className="ghost" onClick={() => setInviting(true)}>
            Add a partner (e.g. employer, sponsor)
          </button>
        )
      )}
      {inviting && (
        <form onSubmit={invite} className="detail" style={{ paddingTop: 0 }}>
          <div className="field">
            <label htmlFor="sp-email">Partner email</label>
            <input id="sp-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="sp-label">Label (e.g. Employer, Sponsor)</label>
            <input id="sp-label" type="text" className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={60} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="btns">
            <button type="button" className="ghost" disabled={busy} onClick={() => { setInviting(false); setError(null); }}>Cancel</button>
            <button type="submit" className="big" disabled={busy}>{busy ? "Sending…" : "Send invite"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
