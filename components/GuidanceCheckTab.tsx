"use client";

import { useState, useEffect } from "react";
import type { GuidanceCheckRunResult, GuidanceCheckItemResult } from "@/lib/guidance-check";
import type { GuidanceCheckItemResponse } from "@/lib/guidance-check-runs";
import { api } from "./ui";

interface Props {
  clientId: string;
  aiEnabled: boolean;
  isAdmin: boolean;
  toast: (msg: string) => void;
}

interface RunStatus {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  result: GuidanceCheckRunResult | null;
  itemResponses: Record<string, GuidanceCheckItemResponse[]>;
  itemIdByRequirementId: Record<string, string>;
}

const VERDICT_LABEL: Record<string, string> = {
  MET: "✓",
  NOT_MET: "✗",
  UNCLEAR: "?",
  NOT_APPLICABLE: "—",
};
const VERDICT_CLASS: Record<string, string> = {
  MET: "verdict-ok",
  NOT_MET: "verdict-fail",
  UNCLEAR: "verdict-unclear",
  NOT_APPLICABLE: "verdict-na",
};

function VerdictBadge({ v }: { v: string }) {
  return (
    <span className={`verdict-badge ${VERDICT_CLASS[v] ?? ""}`} aria-label={v}>
      {VERDICT_LABEL[v] ?? v}
    </span>
  );
}

function CoveragePanel({ coverage }: { coverage: GuidanceCheckRunResult["coverage"] }) {
  const { notChecked, mentionedNotUploaded } = coverage;
  if (notChecked.length === 0 && mentionedNotUploaded.length === 0) return null;
  return (
    <section className="guidance-coverage" aria-label="Coverage">
      {notChecked.length > 0 && (
        <div className="coverage-group">
          <h4 className="small">Not checked (not uploaded)</h4>
          <ul className="coverage-list small">
            {notChecked.map((item, i) => (
              <li key={i} className="muted">
                {item.whatIsChecked} — <em>{item.reason}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mentionedNotUploaded.length > 0 && (
        <div className="coverage-group">
          <h4 className="small">Mentioned but not uploaded</h4>
          <ul className="coverage-list small">
            {mentionedNotUploaded.map((s, i) => (
              <li key={i} className="muted">
                {s.title}
                {s.url && (
                  <> — <a href={s.url} target="_blank" rel="noopener noreferrer" className="small">{s.url}</a></>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface TestCasePage {
  docId: string;
  title: string;
  uploaderKind: "CLIENT" | "SPONSOR";
  pageNumber: number;
  text: string;
}

interface TestCasePreview {
  requirement: {
    id: string; whatIsChecked: string; ruleType: string;
    limitOrThreshold: string | null; evidenceNeeded: string; citationQuote: string;
  };
  pages: TestCasePage[];
  expectedVerdict: string;
  caseworkerNote: string | null;
  route: string;
  anchorDate: string;
}

interface RequirementCardProps {
  item: GuidanceCheckItemResult;
  clientId: string;
  runId: string;
  itemId: string;
  responses: GuidanceCheckItemResponse[];
  isAdmin: boolean;
  onRespond: (requirementId: string, responses: GuidanceCheckItemResponse[]) => void;
  toast: (msg: string) => void;
}

function RequirementCard({ item, clientId, runId, itemId, responses, isAdmin, onRespond, toast }: RequirementCardProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [pendingAction, setPendingAction] = useState<"AGREED" | "DISAGREE" | null>(null);

  // Test-case save state machine
  const [tcStep, setTcStep] = useState<"idle" | "loading" | "editing" | "saving" | "saved">("idle");
  const [tcPreview, setTcPreview] = useState<TestCasePreview | null>(null);
  const [tcPages, setTcPages] = useState<TestCasePage[]>([]);
  const [tcConfirmed, setTcConfirmed] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);

  const hasDisagreed = responses.some((r) => r.action === "DISAGREE");

  const ENDPOINT = `/api/staff/cases/${clientId}/guidance-check/${runId}/${itemId}/save-test-case`;

  async function startPreview(expectedVerdict: string) {
    setTcStep("loading");
    setTcError(null);
    const r = await api<{ ok: boolean; preview: TestCasePreview }>(
      ENDPOINT,
      { method: "POST", body: JSON.stringify({ action: "preview", expectedVerdict }) },
    );
    if (!r.ok) {
      setTcStep("idle");
      setTcError(r.error);
      return;
    }
    setTcPreview(r.data.preview);
    setTcPages(r.data.preview.pages.map((p) => ({ ...p })));
    setTcConfirmed(false);
    setTcStep("editing");
  }

  async function confirmSave() {
    if (!tcPreview || !tcConfirmed) return;
    setTcStep("saving");
    setTcError(null);
    const r = await api<{ ok: boolean; fixtureId: string }>(
      ENDPOINT,
      {
        method: "POST",
        body: JSON.stringify({
          action: "confirm",
          expectedVerdict: tcPreview.expectedVerdict,
          pages: tcPages,
          confirmed: true,
          anchorDate: tcPreview.anchorDate,
        }),
      },
    );
    if (!r.ok) {
      setTcStep("editing");
      setTcError(r.error);
      return;
    }
    setTcStep("saved");
    toast("Test case saved.");
  }

  async function respond(action: "AGREED" | "DISAGREE") {
    setBusy(true);
    const r = await api<{ ok: boolean }>(
      `/api/staff/cases/${clientId}/guidance-check/${runId}/${itemId}/respond`,
      { method: "POST", body: JSON.stringify({ action, note: note.trim() || undefined }) },
    );
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setPendingAction(null);
    setNote("");
    setShowNote(false);
    const newResp: GuidanceCheckItemResponse = {
      action,
      note: note.trim() || null,
      staffName: "You",
      createdAt: new Date().toISOString(),
    };
    onRespond(item.requirementId, [...responses.filter((rr) => rr.staffName !== "You"), newResp]);
  }

  return (
    <div className={`doc-check-card ${VERDICT_CLASS[item.verdict] ?? ""}`}>
      <div className="doc-check-header">
        <span className="doc-check-title">{item.whatIsChecked}</span>
        <VerdictBadge v={item.verdict} />
      </div>
      <p className="small muted">{item.detail}</p>
      {item.limitOrThreshold && (
        <p className="small muted">Threshold: {item.limitOrThreshold}</p>
      )}
      {item.evidenceFound.length > 0 && (
        <details className="summary-facts">
          <summary className="muted small">
            {item.evidenceFound.length} piece{item.evidenceFound.length === 1 ? "" : "s"} of evidence
          </summary>
          <ul className="claims-list">
            {item.evidenceFound.map((e, i) => (
              <li key={i} className="small">
                <span className="muted">{e.factKind}:</span> {e.value}
                {e.quote !== e.value && (
                  <blockquote className="claim-quote small">{e.quote}</blockquote>
                )}
                <span className="muted"> · {e.docTitle}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="summary-facts">
        <summary className="muted small">Guidance quote</summary>
        <blockquote className="claim-quote small">{item.citationQuote}</blockquote>
      </details>

      {/* Caseworker responses */}
      {responses.length > 0 && (
        <ul className="guidance-responses small">
          {responses.map((rr, i) => (
            <li key={i} className={`guidance-response guidance-response--${rr.action.toLowerCase()}`}>
              <strong>{rr.staffName}</strong>{" "}
              <span className="muted">{rr.action === "AGREED" ? "agreed" : "disagreed"}</span>
              {rr.note && <span> — {rr.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Admin: save as test case (only after a DISAGREE response) */}
      {isAdmin && hasDisagreed && (
        <div className="guidance-test-case-panel">
          {tcStep === "idle" && (
            <div className="guidance-respond-row">
              <span className="small muted">Save as test case — expected verdict:</span>
              {(["MET", "NOT_MET", "UNCLEAR"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-small"
                  onClick={() => startPreview(v)}
                  aria-label={`Save as test case — expected verdict ${v}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {tcStep === "loading" && (
            <p className="small muted">Loading scrubbed text…</p>
          )}

          {tcError && (
            <p className="small error" role="alert">{tcError}</p>
          )}

          {(tcStep === "editing" || tcStep === "saving") && tcPreview && (
            <div className="tc-editor">
              <div className="tc-warning" role="alert">
                <strong>Before saving:</strong> Replace every real detail with made-up ones.
                Real names, numbers, accounts, employers and addresses must not remain.
                The text has been pre-scrubbed but you must check it carefully.
                Check any remaining dates are not personal — for example a date of birth
                written in an unusual way.
              </div>

              <p className="small muted">
                Requirement: <strong>{tcPreview.requirement.whatIsChecked}</strong>
                {tcPreview.requirement.limitOrThreshold && (
                  <> — {tcPreview.requirement.limitOrThreshold}</>
                )}
              </p>
              <p className="small muted">
                Expected verdict: <strong>{tcPreview.expectedVerdict}</strong>
              </p>

              {tcPages.map((page, i) => (
                <div key={i} className="tc-page-editor">
                  <label className="small muted" htmlFor={`tc-page-${item.requirementId}-${i}`}>
                    {page.title} — page {page.pageNumber} ({page.uploaderKind.toLowerCase()})
                  </label>
                  <textarea
                    id={`tc-page-${item.requirementId}-${i}`}
                    className="small tc-page-text"
                    rows={8}
                    maxLength={50000}
                    disabled={tcStep === "saving"}
                    value={page.text}
                    onChange={(e) => {
                      const updated = [...tcPages];
                      updated[i] = { ...updated[i]!, text: e.target.value };
                      setTcPages(updated);
                    }}
                  />
                </div>
              ))}

              <label className="tc-confirm-label small">
                <input
                  type="checkbox"
                  checked={tcConfirmed}
                  disabled={tcStep === "saving"}
                  onChange={(e) => setTcConfirmed(e.target.checked)}
                />
                {" "}I have removed all real personal details from the text above.
              </label>

              <div className="guidance-respond-row">
                <button
                  type="button"
                  className="btn-small btn-primary"
                  disabled={!tcConfirmed || tcStep === "saving"}
                  onClick={confirmSave}
                >
                  {tcStep === "saving" ? "Saving…" : "Save test case"}
                </button>
                <button
                  type="button"
                  className="btn-small"
                  disabled={tcStep === "saving"}
                  onClick={() => { setTcStep("idle"); setTcPreview(null); setTcError(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {tcStep === "saved" && (
            <p className="small muted">Test case saved.</p>
          )}
        </div>
      )}

      {/* Agree / Disagree actions */}
      <div className="guidance-respond-row">
        <button
          type="button"
          className="btn-small btn-ok"
          disabled={busy}
          onClick={() => { setPendingAction("AGREED"); setShowNote(true); }}
          aria-label="Agree with this result"
        >
          Agree
        </button>
        <button
          type="button"
          className="btn-small btn-warn"
          disabled={busy}
          onClick={() => { setPendingAction("DISAGREE"); setShowNote(true); }}
          aria-label="Disagree with this result"
        >
          Disagree
        </button>
      </div>

      {showNote && pendingAction && (
        <div className="guidance-respond-note">
          <label className="small" htmlFor={`note-${item.requirementId}`}>
            Note (optional)
          </label>
          <textarea
            id={`note-${item.requirementId}`}
            className="small"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="guidance-respond-row">
            <button
              type="button"
              className="btn-small btn-primary"
              disabled={busy}
              onClick={() => respond(pendingAction)}
            >
              {busy ? "Saving…" : `Confirm ${pendingAction === "AGREED" ? "agree" : "disagree"}`}
            </button>
            <button
              type="button"
              className="btn-small"
              disabled={busy}
              onClick={() => { setShowNote(false); setPendingAction(null); setNote(""); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GuidanceCheckTab({ clientId, aiEnabled, isAdmin, toast }: Props) {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const inProgress = run !== null && run.status !== "COMPLETE" && run.status !== "FAILED";
  const progressPct = run ? Math.round((run.done / Math.max(run.total, 1)) * 100) : 0;

  useEffect(() => {
    if (!runId) return;
    if (run?.status === "COMPLETE" || run?.status === "FAILED") return;
    const tid = setTimeout(async () => {
      const r = await api<RunStatus>(`/api/staff/cases/${clientId}/guidance-check/${runId}`);
      if (r.ok) setRun(r.data);
    }, 1500);
    return () => clearTimeout(tid);
  }, [runId, run, clientId]);

  async function startRun() {
    setBusy(true);
    setRun(null);
    setRunId(null);
    const r = await api<{ runId: string }>(
      `/api/staff/cases/${clientId}/guidance-check`,
      { method: "POST" },
    );
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setRunId(r.data.runId);
  }

  function handleRespond(requirementId: string, responses: GuidanceCheckItemResponse[]) {
    setRun((prev) => {
      if (!prev) return prev;
      return { ...prev, itemResponses: { ...prev.itemResponses, [requirementId]: responses } };
    });
  }

  if (!aiEnabled) {
    return <p className="muted">AI analysis is not enabled for this firm.</p>;
  }

  return (
    <div className="analyse-tab">
      <h2 data-focus tabIndex={-1}>Guidance check</h2>

      <section className="case-summary-section">
        <div className="case-summary-header">
          <h3>Check against approved requirements</h3>
          <button
            type="button"
            className="big"
            onClick={startRun}
            disabled={busy || inProgress}
            aria-label="Run guidance check"
          >
            {busy || inProgress ? "Checking…" : "Run check"}
          </button>
        </div>

        {(inProgress || run) && (
          <div className="summary-progress" aria-live="polite">
            {inProgress && (
              <>
                <div
                  className="progress-bar"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <p className="muted small">
                  Checking requirement {run.done + 1} of {run.total}…
                </p>
              </>
            )}

            {run?.status === "FAILED" && (
              <p className="error" role="alert">Guidance check failed. Please try again.</p>
            )}

            {run?.status === "COMPLETE" && run.result && (
              <div className="summary-results">
                <CoveragePanel coverage={run.result.coverage} />

                <p className="guidance-summary-line">
                  {run.result.summaryLine}
                </p>

                <div className="doc-check-list">
                  {run.result.items.map((item) => (
                    <RequirementCard
                      key={item.requirementId}
                      item={item}
                      clientId={clientId}
                      runId={run.id}
                      itemId={run.itemIdByRequirementId[item.requirementId] ?? ""}
                      responses={run.itemResponses[item.requirementId] ?? []}
                      isAdmin={isAdmin}
                      onRespond={handleRespond}
                      toast={toast}
                    />
                  ))}
                </div>
              </div>
            )}

            {run?.status === "COMPLETE" && run.done === 0 && (
              <p className="muted small">No requirements could be checked.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
