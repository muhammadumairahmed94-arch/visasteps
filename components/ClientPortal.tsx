"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientPortalView, SponsorPortalView } from "@/lib/documents";
import { guideShape } from "@/lib/files";
import { STAGES, findNextDoc } from "@/lib/case-stage";
import ClientSignIn from "./ClientSignIn";
import ScanFlow from "./ScanFlow";
import SponsorPortal from "./SponsorPortal";
import MessageThread from "./MessageThread";
import { CLIENT_LABEL, Page, Row, Tabs, api, useHashView, useToast, type Status } from "./ui";

type Tab = "docs" | "visa" | "messages" | "me" | "help";
type View = { tab: Tab; group?: string; doc?: string; sub?: string };
type Doc = ClientPortalView["groups"][number]["docs"][number] & { status: Status; dates: string | null; exampleImage: string | null; howToGet: string | null; missingAt: string | null; missingResponse: string | null };
const sent = (s: Status) => s === "SENT" || s === "OK";

const parse = (h: string): View => {
  const [tab, kind, id] = h.split("/");
  if (tab === "visa" || tab === "help" || tab === "messages") return { tab };
  if (tab === "me") return { tab, sub: kind };
  return { tab: "docs", group: kind === "g" ? id : undefined, doc: kind === "d" ? id : undefined };
};
const format = (v: View) => (v.doc ? `docs/d/${v.doc}` : v.group ? `docs/g/${encodeURIComponent(v.group)}` : v.sub ? `${v.tab}/${v.sub}` : v.tab);

export default function ClientPortal({ token: linkToken }: { token?: string }) {
  // The emailed link works once; forget it after use so signing out shows the normal sign-in
  const [token, setToken] = useState(linkToken);
  const [data, setData] = useState<ClientPortalView | null>(null);
  const [sponsorData, setSponsorData] = useState<SponsorPortalView | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "in">(token ? "signedOut" : "loading");
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [view, go] = useHashView(parse, format);
  const [toast, toastNode] = useToast();

  const load = useCallback(
    () =>
      api<ClientPortalView | SponsorPortalView>("/api/client/portal").then((r) => {
        if (r.ok) {
          if (r.data.isSponsor) {
            setSponsorData(r.data as SponsorPortalView);
          } else {
            setData(r.data as ClientPortalView);
            setUnreadMessages((r.data as ClientPortalView).unreadMessages);
          }
          setState("in");
        } else setState("signedOut");
      }),
    [],
  );

  useEffect(() => {
    if (!linkToken) void load();
  }, [linkToken, load]);

  if (state === "in" && sponsorData)
    return <SponsorPortal token={undefined} />;

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
          reviewDays={data.firm.reviewDays}
          onBack={() => go({ tab: "docs", group: group.id })}
          onSent={async (msg) => {
            await load();
            go({ tab: "docs", group: group.id });
            toast(msg);
          }}
          onMissing={async (msg) => {
            await load();
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
        <>
          <NextStep docs={docs} onGo={(id) => go({ tab: "docs", doc: id })} />
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
        </>
      );
  } else if (view.tab === "visa")
    body = (
      <div className="detail">
        <h2 data-focus tabIndex={-1}>Where is my case?</h2>
        <CaseTimeline stage={data.caseStage} />
      </div>
    );
  else if (view.tab === "messages")
    body = (
      <>
        <h2 data-focus tabIndex={-1}>Messages</h2>
        <MessageThread
          endpoint="/api/client/messages"
          senderKind="CLIENT"
          onRead={() => setUnreadMessages(0)}
        />
      </>
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
        tabs={[
          ["docs", "Documents"],
          ["visa", "Visa"],
          ["messages", unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"],
          ["me", "Profile"],
          ["help", "Help"],
        ]}
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

function NextStep({ docs, onGo }: { docs: Doc[]; onGo: (id: string) => void }) {
  const next = findNextDoc(docs);
  if (!next)
    return (
      <div className="next-step done">
        <p><b>All done for now.</b> We&apos;ll contact you if we need anything else.</p>
      </div>
    );
  const isRedo = next.status === "REDO";
  return (
    <div className={`next-step${isRedo ? " attn" : ""}`}>
      <p className="eyebrow">Your next step</p>
      <b>{next.title}</b>
      {isRedo && next.note && <p className="muted">Your caseworker asked: {next.note}</p>}
      <button type="button" className="big" onClick={() => onGo(next.id)}>
        {isRedo ? "Upload again" : "Send this document"}
      </button>
    </div>
  );
}

function CaseTimeline({ stage }: { stage: string }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="timeline" aria-label="Case stages">
      {STAGES.map((s, i) => {
        const cls = i < idx ? "past" : i === idx ? "current" : "future";
        return (
          <li key={s.key} className={cls}>
            <span className="t-label">{s.label}</span>
            {i === idx && <span className="t-detail">{s.detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function DocDetail({ doc, backLabel, reviewDays, onBack, onSent, onMissing }: {
  doc: Doc;
  backLabel: string;
  reviewDays: number;
  onBack: () => void;
  onSent: (msg: string) => void;
  onMissing: (msg: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [reportingMissing, setReportingMissing] = useState(false);
  const [missingReason, setMissingReason] = useState("");
  const [missingBusy, setMissingBusy] = useState(false);

  async function submitMissing() {
    if (!missingReason.trim()) return setError("Please tell us why in a few words.");
    setMissingBusy(true);
    setError(null);
    const r = await api<{ message: string }>(`/api/client/documents/${doc.id}/missing`, { method: "POST", json: { reason: missingReason } });
    setMissingBusy(false);
    if (!r.ok) return setError(r.error);
    setReportingMissing(false);
    setMissingReason("");
    onMissing(r.data.message);
  }

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← {backLabel}</button>
      <div className="detail">
        <h2 data-focus tabIndex={-1}>{doc.title}</h2>
        <p className="why">{doc.why}</p>
        {doc.dates && <p className="date-hint">Dates needed: <b>{doc.dates}</b></p>}
        {doc.exampleImage && (
          <figure className="sample-fig">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/samples/${doc.exampleImage}`} alt={`Example of ${doc.title}`} className="sample-img" />
            <figcaption className="muted">Example</figcaption>
          </figure>
        )}
        {doc.howToGet && (
          <div className="how-to">
            <b>How to get this</b>
            <p>{doc.howToGet}</p>
          </div>
        )}
        {doc.status === "REDO" && doc.note && (
          <div className="note">
            <b>Caseworker note:</b> {doc.note}
          </div>
        )}
        {doc.missingAt && (
          <div className="note">
            <b>We have told your caseworker.</b> They will be in touch soon. You can still upload the document if you find it.
          </div>
        )}
        {doc.missingResponse && (
          <div className="note">
            <b>Your caseworker replied:</b> {doc.missingResponse}
          </div>
        )}
        {doc.files.length > 0 && (
          <div className="files">
            {doc.files.map((f, i) => (
              <div key={i}>✓ {f.orig} · sent {f.date}</div>
            ))}
          </div>
        )}
        {doc.status === "OK" ? (
          <p className="done-tag">✓ Checked and approved</p>
        ) : (
          <>
            <ScanFlow
              docId={doc.id}
              guideShape={guideShape(doc.typeKey)}
              reviewDays={reviewDays}
              onSent={onSent}
            />
            {!doc.missingAt && !doc.missingResponse && !reportingMissing && (
              <button type="button" className="link" onClick={() => setReportingMissing(true)}>
                I can&apos;t find this document
              </button>
            )}
            {reportingMissing && (
              <div className="missing-form">
                <label htmlFor="missing-reason">Tell us why, in a few words</label>
                <input
                  id="missing-reason"
                  className="input"
                  value={missingReason}
                  onChange={(e) => setMissingReason(e.target.value)}
                  placeholder="e.g. I do not have a payslip from that period"
                  maxLength={500}
                  autoFocus
                />
                {error && <p className="error" role="alert">{error}</p>}
                <div className="btns">
                  <button type="button" className="ghost" disabled={missingBusy} onClick={() => { setReportingMissing(false); setMissingReason(""); setError(null); }}>Cancel</button>
                  <button type="button" className="big" disabled={missingBusy} onClick={submitMissing}>{missingBusy ? "Sending…" : "Tell my caseworker"}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
