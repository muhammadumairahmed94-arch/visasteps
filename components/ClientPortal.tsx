"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type { ClientPortalView } from "@/lib/documents";
import ClientSignIn from "./ClientSignIn";
import { CLIENT_LABEL, Page, Row, Tabs, api, useHashView, useToast, type Status } from "./ui";

type Tab = "docs" | "visa" | "me" | "help";
type View = { tab: Tab; group?: string; doc?: string; sub?: string };
type Doc = ClientPortalView["groups"][number]["docs"][number] & { status: Status };

const MAX_BYTES = 20 * 1024 * 1024;
const sent = (s: Status) => s === "SENT" || s === "OK";

const parse = (h: string): View => {
  const [tab, kind, id] = h.split("/");
  if (tab === "visa" || tab === "help") return { tab };
  if (tab === "me") return { tab, sub: kind };
  return { tab: "docs", group: kind === "g" ? id : undefined, doc: kind === "d" ? id : undefined };
};
const format = (v: View) => (v.doc ? `docs/d/${v.doc}` : v.group ? `docs/g/${encodeURIComponent(v.group)}` : v.sub ? `${v.tab}/${v.sub}` : v.tab);

export default function ClientPortal({ token: linkToken }: { token?: string }) {
  // The emailed link works once; forget it after use so signing out shows the normal sign-in
  const [token, setToken] = useState(linkToken);
  const [data, setData] = useState<ClientPortalView | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "in">(token ? "signedOut" : "loading");
  const [view, go] = useHashView(parse, format);
  const [toast, toastNode] = useToast();

  const load = useCallback(
    () =>
      api<ClientPortalView>("/api/client/portal").then((r) => {
        if (r.ok) {
          setData(r.data);
          setState("in");
        } else setState("signedOut");
      }),
    [],
  );

  useEffect(() => {
    if (!linkToken) void load();
  }, [linkToken, load]);

  if (state === "loading")
    return (
      <Page>
        <p className="muted" role="status">Loading…</p>
      </Page>
    );

  if (state === "signedOut" || !data)
    return (
      <Page>
        <ClientSignIn
          token={token}
          onDone={async () => {
            if (token) {
              history.replaceState(null, "", "/");
              setToken(undefined);
            }
            await load();
            toast("Signed in");
          }}
        />
        {toastNode}
      </Page>
    );

  const docs = data.groups.flatMap((g) => g.docs) as Doc[];
  const required = docs.filter((d) => d.required);
  const done = required.filter((d) => sent(d.status)).length;

  let body: React.ReactNode;
  if (view.tab === "docs") {
    const doc = view.doc ? docs.find((d) => d.id === view.doc) : undefined;
    const group = data.groups.find((g) => g.id === view.group || g.docs.some((d) => d.id === view.doc));
    if (doc && group)
      body = (
        <DocDetail
          doc={doc}
          backLabel={group.label}
          onBack={() => go({ tab: "docs", group: group.id })}
          onSent={async (msg) => {
            await load();
            go({ tab: "docs", group: group.id });
            toast(msg);
          }}
        />
      );
    else if (group)
      body = (
        <>
          <button type="button" className="back" onClick={() => go({ tab: "docs" })}>← All documents</button>
          <h2 data-focus tabIndex={-1}>{group.label}</h2>
          <div className="list">
            {(group.docs as Doc[]).map((d) => (
              <Row key={d.id} status={d.status} labels={CLIENT_LABEL} onClick={() => go({ tab: "docs", doc: d.id })}>
                {d.title}
                {!d.required && <span className="muted"> (optional)</span>}
              </Row>
            ))}
          </div>
        </>
      );
    else
      body = (
        <div className="tiles">
          {data.groups.map((g) => {
            const req = (g.docs as Doc[]).filter((d) => d.required);
            const n = req.filter((d) => sent(d.status)).length;
            const redo = (g.docs as Doc[]).some((d) => d.status === "REDO");
            const all = n === req.length;
            return (
              <button type="button" key={g.id} className={`tile ${redo ? "attn" : all ? "done" : ""}`} onClick={() => go({ tab: "docs", group: g.id })}>
                <b>{g.label}</b>
                <small>{redo ? "Action required" : all ? "All sent ✓" : `${n} of ${req.length} sent`}</small>
              </button>
            );
          })}
        </div>
      );
  } else if (view.tab === "visa")
    body = (
      <div className="detail">
        <h2 data-focus tabIndex={-1}>{data.route}</h2>
        <p className="why">Visa route confirmed by the caseworker. No action needed.</p>
      </div>
    );
  else if (view.tab === "me" && view.sub === "details")
    body = (
      <>
        <button type="button" className="back" onClick={() => go({ tab: "me" })}>← Profile</button>
        <div className="detail">
          <h2 data-focus tabIndex={-1}>Personal details</h2>
          <p className="why">
            {data.details.name}
            <br />
            {data.details.mobile && (
              <>
                {data.details.mobile}
                <br />
              </>
            )}
            <span style={{ overflowWrap: "anywhere" }}>{data.details.email}</span>
          </p>
          <p className="muted">To update these details, contact us on {data.firm.phone}.</p>
        </div>
      </>
    );
  else if (view.tab === "me")
    body = (
      <div className="list">
        <Row status="OK" labels={CLIENT_LABEL} onClick={() => go({ tab: "me", sub: "details" })}>Personal details</Row>
        {/* Placeholders from the design until onboarding data exists (see build notes) */}
        <Row status="OK" labels={CLIENT_LABEL}>Family details</Row>
        <Row status="OK" labels={CLIENT_LABEL}>Client agreement</Row>
      </div>
    );
  else
    body = (
      <div className="detail">
        <h2 data-focus tabIndex={-1}>Contact us</h2>
        <p className="why">
          Our team is happy to help.
          <br />
          Call {data.firm.whatsapp ? "or WhatsApp " : ""}
          <b style={{ userSelect: "all" }}>{data.firm.phone}</b>
        </p>
        {data.firm.whatsapp && (
          <a className="ghost" href={`https://wa.me/${data.firm.whatsapp}`} target="_blank" rel="noopener" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
            Message us on WhatsApp
          </a>
        )}
        <p className="muted">Unsure about a document? Upload it and our team will check it.</p>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            await api("/api/auth/client/signout", { method: "POST" });
            history.replaceState(null, "", "/");
            setData(null);
            setState("signedOut");
          }}
        >
          Sign out
        </button>
      </div>
    );

  return (
    <Page>
      <section className="hello">
        <p className="eyebrow">{data.route}</p>
        <h1>Hello {data.firstName}</h1>
        <p>
          {done} of {required.length} documents sent
        </p>
        <div className="progress" role="progressbar" aria-label="Documents sent" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={done}>
          <i style={{ width: `${Math.round((done / required.length) * 100)}%` }} />
        </div>
      </section>
      <Tabs<Tab>
        label="Sections"
        tabs={[["docs", "Documents"], ["visa", "Visa"], ["me", "Profile"], ["help", "Help"]]}
        value={view.tab}
        onChange={(t) => go({ tab: t })}
      />
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${view.tab}`} className="stack">
        {body}
      </div>
      {toastNode}
    </Page>
  );
}

function DocDetail({ doc, backLabel, onBack, onSent }: { doc: Doc; backLabel: string; onBack: () => void; onSent: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    if (files.some((f) => f.size > MAX_BYTES)) return setError("This file is too big. Please send a file under 20 MB.");
    setBusy(true);
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const r = await api<{ message: string }>(`/api/client/documents/${doc.id}`, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSent(r.data.message);
  }

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← {backLabel}</button>
      <div className="detail">
        <h2 data-focus tabIndex={-1}>{doc.title}</h2>
        <p className="why">{doc.why}</p>
        {doc.status === "REDO" && doc.note && (
          <div className="note">
            <b>Caseworker note:</b> {doc.note}
          </div>
        )}
        {doc.files.length > 0 && (
          <div className="files">
            {doc.files.map((f, i) => (
              <div key={i}>✓ {f.orig} · sent {f.date}</div>
            ))}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {doc.status === "OK" ? (
          <p className="done-tag">✓ Checked and approved</p>
        ) : (
          <>
            <label className="big" htmlFor="up" aria-disabled={busy}>
              {busy ? "Sending…" : doc.files.length && doc.status !== "REDO" ? "Send more" : "Take a photo or choose a file"}
              <input type="file" id="up" accept="image/*,.pdf,.heic,.heif" multiple disabled={busy} onChange={onFiles} />
            </label>
            {busy && <p className="sr-only" role="status">Uploading</p>}
            <p className="muted">Unsure if it is right? Upload it and our team will check it.</p>
          </>
        )}
      </div>
    </>
  );
}
