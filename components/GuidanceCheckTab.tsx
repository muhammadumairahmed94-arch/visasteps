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
  const [savingTestCase, setSavingTestCase] = useState(false);
  const [testCaseSaved, setTestCaseSaved] = useState(false);

  const hasDisagreed = responses.some((r) => r.action === "DISAGREE");

  async function saveTestCase(expectedVerdict: string) {
    setSavingTestCase(true);
    const r = await api<{ ok: boolean }>(
      `/api/staff/cases/${clientId}/guidance-check/${runId}/${itemId}/save-test-case`,
      { method: "POST", body: JSON.stringify({ expectedVerdict }) },
    );
    setSavingTestCase(false);
    if (!r.ok) { toast(r.error); return; }
    setTestCaseSaved(true);
    toast("Test case saved to evals/.");
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
    // Optimistically update responses list
    const existing = responses.filter(() => true); // fresh from server on next poll
    const newResp: GuidanceCheckItemResponse = {
      action,
      note: note.trim() || null,
      staffName: "You",
      createdAt: new Date().toISOString(),
    };
    onRespond(item.requirementId, [...existing.filter((rr) => rr.staffName !== "You"), newResp]);
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
        <div className="guidance-respond-row">
          {testCaseSaved ? (
            <span className="small muted">Test case saved.</span>
          ) : (
            <>
              <span className="small muted">Save as test case with expected verdict:</span>
              {(["MET", "NOT_MET", "UNCLEAR"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="btn-small"
                  disabled={savingTestCase}
                  onClick={() => saveTestCase(v)}
                  aria-label={`Save as test case with expected verdict ${v}`}
                >
                  {savingTestCase ? "Saving…" : v}
                </button>
              ))}
            </>
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
