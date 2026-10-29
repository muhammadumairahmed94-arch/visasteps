"use client";

import { useCallback, useEffect, useState } from "react";
import type { SponsorPortalView } from "@/lib/documents";
import { guideShape } from "@/lib/files";
import ClientSignIn from "./ClientSignIn";
import ScanFlow from "./ScanFlow";
import { CLIENT_LABEL, Page, Row, api, useHashView, useToast, type Status } from "./ui";

type View = { group?: string; doc?: string };
type Doc = SponsorPortalView["groups"][number]["docs"][number] & { status: Status };

const parse = (h: string): View => {
  const [kind, id] = h.split("/");
  if (kind === "d") return { doc: id };
  if (kind === "g") return { group: id };
  return {};
};
const format = (v: View) => (v.doc ? `d/${v.doc}` : v.group ? `g/${encodeURIComponent(v.group)}` : "");

const PRIVACY_SEEN_KEY = "sponsor_privacy_seen";

export default function SponsorPortal({ token: linkToken }: { token?: string }) {
  const [token, setToken] = useState(linkToken);
  const [data, setData] = useState<SponsorPortalView | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "in">(token ? "signedOut" : "loading");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [view, go] = useHashView(parse, format);
  const [toast, toastNode] = useToast();

  const load = useCallback(
    () =>
      api<SponsorPortalView>("/api/client/portal").then((r) => {
        if (r.ok) {
          setData(r.data);
          const seen = sessionStorage.getItem(PRIVACY_SEEN_KEY);
          if (!seen) setShowPrivacy(true);
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

  if (showPrivacy)
    return (
      <Page>
        <div className="detail">
          <h1>Before you continue</h1>
          <p>
            {data.firm.name} has asked you to upload documents to help with a UK visa application.
            Please read how we use your information before continuing.
          </p>
          <p className="why">
            We collect only the documents asked of you. We store them securely and share them only with
            {data.firm.name} and UK Visas &amp; Immigration as part of the application. You can ask us to
            correct or delete your information at any time by emailing {data.firm.name}.
          </p>
          <p className="muted"><a href="/privacy" target="_blank" rel="noopener noreferrer">Read our full privacy notice</a></p>
          <button
            type="button"
            className="big"
            onClick={() => {
              sessionStorage.setItem(PRIVACY_SEEN_KEY, "1");
              setShowPrivacy(false);
            }}
          >
            I understand and agree — continue
          </button>
        </div>
      </Page>
    );

  const docs = data.groups.flatMap((g) => g.docs) as Doc[];

  const [kind, id] = [view.doc ? "doc" : view.group ? "group" : "home", view.doc ?? view.group];
  const doc = kind === "doc" ? docs.find((d) => d.id === id) : undefined;
  const group = data.groups.find((g) => g.id === view.group || g.docs.some((d) => d.id === view.doc));

  let body: React.ReactNode;
  if (kind === "doc" && doc && group) {
    body = (
      <SponsorDocDetail
        doc={doc}
        backLabel={group.label}
        reviewDays={data.firm.reviewDays}
        onBack={() => go({ group: group.id })}
        onSent={async (msg) => {
          await load();
          go({ group: group.id });
          toast(msg);
        }}
        onMissing={async (msg) => {
          await load();
          toast(msg);
        }}
      />
    );
  } else if (group) {
    body = (
      <>
        <button type="button" className="back" onClick={() => go({})}>← All documents</button>
        <h2 data-focus tabIndex={-1}>{group.label}</h2>
        <div className="list">
          {(group.docs as Doc[]).map((d) => (
            <Row key={d.id} status={d.status} labels={CLIENT_LABEL} onClick={() => go({ doc: d.id })}>
              {d.title}
              {!d.required && <span className="muted"> (optional)</span>}
            </Row>
          ))}
        </div>
      </>
    );
  } else {
    const required = docs.filter((d) => d.required);
    const done = required.filter((d) => d.status === "SENT" || d.status === "OK").length;
    body = (
      <>
        <div className="next-step">
          <p>
            {done === required.length
              ? "All done for now. We'll contact you if we need anything else."
              : `${done} of ${required.length} documents sent`}
          </p>
        </div>
        <div className="tiles">
          {data.groups.map((g) => {
            const req = (g.docs as Doc[]).filter((d) => d.required);
            const n = req.filter((d) => d.status === "SENT" || d.status === "OK").length;
            const redo = (g.docs as Doc[]).some((d) => d.status === "REDO");
            const all = n === req.length;
            return (
              <button type="button" key={g.id} className={`tile ${redo ? "attn" : all ? "done" : ""}`} onClick={() => go({ group: g.id })}>
                <b>{g.label}</b>
                <small>{redo ? "Action required" : all ? "All sent ✓" : `${n} of ${req.length} sent`}</small>
              </button>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <Page>
      <section className="hello">
        <p className="eyebrow">{data.sponsorLabel} — {data.firm.name}</p>
        <h1>{data.firstName ? `Hello ${data.firstName}` : "Your documents"}</h1>
      </section>
      <div className="stack">{body}</div>
      <div style={{ marginTop: "2rem", textAlign: "center" }}>
        <button
          type="button"
          className="link"
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
      {toastNode}
    </Page>
  );
}

function SponsorDocDetail({ doc, backLabel, reviewDays, onBack, onSent, onMissing }: {
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
