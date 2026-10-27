"use client";

import { useState, useEffect } from "react";
import type { GuidanceCheckRunResult, GuidanceCheckItemResult } from "@/lib/guidance-check";
import { api } from "./ui";

interface Props {
  clientId: string;
  aiEnabled: boolean;
  toast: (msg: string) => void;
}

interface RunStatus {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  result: GuidanceCheckRunResult | null;
}

const VERDICT_LABEL: Record<string, string> = { MET: "✓", NOT_MET: "✗", UNCLEAR: "?" };
const VERDICT_CLASS: Record<string, string> = { MET: "verdict-ok", NOT_MET: "verdict-fail", UNCLEAR: "verdict-unclear" };

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

function RequirementCard({ item }: { item: GuidanceCheckItemResult }) {
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
    </div>
  );
}

export default function GuidanceCheckTab({ clientId, aiEnabled, toast }: Props) {
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
                    <RequirementCard key={item.requirementId} item={item} />
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
