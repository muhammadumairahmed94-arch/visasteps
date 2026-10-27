"use client";

import { useState, useEffect, type FormEvent } from "react";
import type { AnalysisView } from "@/lib/case-analysis";
import type { AiCaseClaim } from "@/lib/adapters/ai";
import type { CheckDocumentsResult, DocCheckResult, CrossDocNameCheck, PayslipSummary, PersonPayslipSummary } from "@/lib/doc-checks";
import { api } from "./ui";

interface Props {
  clientId: string;
  view: AnalysisView;
  onRefresh: () => void;
  toast: (msg: string) => void;
}

interface RunStatus {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  result: CheckDocumentsResult | null;
}

const VERDICT_LABEL: Record<string, string> = { OK: "✓", UNCLEAR: "?", FAIL: "✗" };
const VERDICT_CLASS: Record<string, string> = { OK: "verdict-ok", UNCLEAR: "verdict-unclear", FAIL: "verdict-fail" };

function VerdictBadge({ v }: { v: string }) {
  return (
    <span className={`verdict-badge ${VERDICT_CLASS[v] ?? ""}`} aria-label={v}>
      {VERDICT_LABEL[v] ?? v}
    </span>
  );
}

function DocResultCard({ doc }: { doc: DocCheckResult }) {
  return (
    <div className={`doc-check-card ${VERDICT_CLASS[doc.verdict] ?? ""}`}>
      <div className="doc-check-header">
        <span className="doc-check-title">
          {doc.uploaderKind === "SPONSOR" ? "Partner document: " : ""}{doc.title}
        </span>
        <VerdictBadge v={doc.verdict} />
      </div>
      {doc.checks.length > 0 && (
        <ul className="check-list">
          {doc.checks.map((c, i) => (
            <li key={i} className="check-item">
              <VerdictBadge v={c.verdict} />
              <strong className="small">{c.name}</strong>
              <span className="muted small"> — {c.detail}</span>
              {c.factQuote && (
                <blockquote className="claim-quote small">{c.factQuote}</blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
      {doc.summaryFacts.length > 0 && (
        <details className="summary-facts">
          <summary className="muted small">
            {doc.summaryFacts.length} extracted fact{doc.summaryFacts.length === 1 ? "" : "s"}
          </summary>
          <ul className="claims-list">
            {doc.summaryFacts.map((f, i) => (
              <li key={i} className="small">
                <span className="muted">{f.factKind}:</span> {f.value}
                <blockquote className="claim-quote small">{f.quote}</blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CrossDocChecks({ checks }: { checks: CrossDocNameCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <section className="cross-doc-checks">
      <h4 className="small">Cross-document name consistency</h4>
      <ul className="check-list">
        {checks.map((c, i) => (
          <li key={i} className="check-item">
            <VerdictBadge v={c.verdict} />
            <strong className="small">{c.expectedName}</strong>
            <span className="muted small"> — {c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonIncomeSection({ label, s }: { label: string; s: PersonPayslipSummary }) {
  const { earliest, latest } = s.dateRange;
  const dateLabel = earliest && latest && earliest !== latest
    ? `${earliest} – ${latest}`
    : earliest ?? null;
  return (
    <div className="person-income">
      <strong className="small">{label}</strong>
      <ul className="claims-list small">
        {s.grossEntries.map((e, i) => (
          <li key={i}>
            {e.formattedAmount} gross
            {e.payPeriod !== "unknown" ? ` (${e.payPeriod})` : ""}
            {e.payDate ? ` — ${e.payDate}` : ""}
            <span className="muted"> · {e.docTitle}</span>
          </li>
        ))}
        {s.otherEntries.map((e, i) => (
          <li key={`o${i}`} className="muted">
            {e.formattedAmount} ({e.payType})
            {e.payDate ? ` — ${e.payDate}` : ""}
            <span> · {e.docTitle}</span>
          </li>
        ))}
      </ul>
      {s.estimateBasis !== "unclear" && s.annualEstimate !== null ? (
        <p className="small">
          Annual estimate: <strong>£{s.annualEstimate.toLocaleString("en-GB")}</strong>
          {" "}({s.payslipCount} payslip{s.payslipCount !== 1 ? "s" : ""}{dateLabel ? `, ${dateLabel}` : ""})
        </p>
      ) : s.grossEntries.length > 0 ? (
        <p className="small muted">Annual estimate: UNCLEAR — pay period not confirmed</p>
      ) : null}
    </div>
  );
}

function PayslipSection({ summary }: { summary: PayslipSummary }) {
  if (!summary.client && !summary.sponsor) return null;
  return (
    <section className="payslip-summary">
      <h4 className="small">Income summary</h4>
      {summary.client && <PersonIncomeSection label="Client" s={summary.client} />}
      {summary.sponsor && <PersonIncomeSection label="Partner" s={summary.sponsor} />}
    </section>
  );
}

export default function AnalyseTab({ clientId, view, onRefresh, toast }: Props) {
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ answer: string; claims: AiCaseClaim[]; notFound: boolean } | null>(null);

  const [summaryRunId, setSummaryRunId] = useState<string | null>(null);
  const [summaryRun, setSummaryRun] = useState<RunStatus | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const foldersToUse = selectedFolders.length > 0 ? selectedFolders : undefined;

  // Poll the summary run until it reaches a terminal state
  useEffect(() => {
    if (!summaryRunId) return;
    if (summaryRun?.status === "COMPLETE" || summaryRun?.status === "FAILED") return;

    const tid = setTimeout(async () => {
      const r = await api<RunStatus>(`/api/staff/cases/${clientId}/doc-checks/${summaryRunId}`);
      if (r.ok) setSummaryRun(r.data);
    }, 1500);
    return () => clearTimeout(tid);
  }, [summaryRunId, summaryRun, clientId]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await api<{ answer: string; claims: AiCaseClaim[]; notFound: boolean }>(
      `/api/staff/cases/${clientId}/analysis`,
      { method: "POST", json: { question: question.trim(), folders: foldersToUse } },
    );
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setResult(r.data);
    onRefresh();
  }

  async function deleteQ(questionId: string) {
    const r = await api(`/api/staff/cases/${clientId}/analysis/${questionId}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error); return; }
    toast("Question deleted.");
    onRefresh();
  }

  async function startSummary() {
    setSummaryBusy(true);
    setSummaryRun(null);
    setSummaryRunId(null);
    const r = await api<{ runId: string }>(
      `/api/staff/cases/${clientId}/doc-checks`,
      { method: "POST" },
    );
    setSummaryBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setSummaryRunId(r.data.runId);
  }

  function toggleFolder(id: string) {
    setSelectedFolders((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  }

  if (!view.aiEnabled) {
    return <p className="muted">AI analysis is not enabled for this firm.</p>;
  }

  const estimatedTokens = foldersToUse
    ? view.folders.filter((f) => foldersToUse.includes(f.id)).reduce((a, f) => a + f.tokenEstimate, 0)
    : view.totalTokenEstimate;

  const overLimit = estimatedTokens > 80_000;
  const summaryInProgress = summaryRun !== null && summaryRun.status !== "COMPLETE" && summaryRun.status !== "FAILED";
  const summaryProgressPct = summaryRun ? Math.round((summaryRun.done / Math.max(summaryRun.total, 1)) * 100) : 0;

  return (
    <div className="analyse-tab">
      <h2 data-focus tabIndex={-1}>Analyse</h2>

      {/* Case Summary section */}
      <section className="case-summary-section">
        <div className="case-summary-header">
          <h3>Case summary</h3>
          <button
            type="button"
            className="big"
            onClick={startSummary}
            disabled={summaryBusy || summaryInProgress || view.folders.length === 0}
            aria-label="Run AI document fact check"
          >
            {summaryBusy || summaryInProgress ? "Checking…" : "Case summary"}
          </button>
        </div>

        {(summaryInProgress || summaryRun) && (
          <div className="summary-progress" aria-live="polite">
            {summaryInProgress && (
              <>
                <div
                  className="progress-bar"
                  role="progressbar"
                  aria-valuenow={summaryProgressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="progress-bar-fill" style={{ width: `${summaryProgressPct}%` }} />
                </div>
                <p className="muted small">
                  Checking document {summaryRun.done + 1} of {summaryRun.total}…
                </p>
              </>
            )}

            {summaryRun?.status === "FAILED" && (
              <p className="error" role="alert">Document check failed. Please try again.</p>
            )}

            {summaryRun?.status === "COMPLETE" && summaryRun.result && (
              <div className="summary-results">
                <CrossDocChecks checks={summaryRun.result.crossDocNameChecks} />
                <PayslipSection summary={summaryRun.result.payslipSummary} />
                <div className="doc-check-list">
                  {summaryRun.result.docs.map((doc) => (
                    <DocResultCard key={doc.docId} doc={doc} />
                  ))}
                </div>
              </div>
            )}

            {summaryRun?.status === "COMPLETE" && summaryRun.done === 0 && (
              <p className="muted small">No readable text found in documents.</p>
            )}
          </div>
        )}
      </section>

      {/* Folder filter */}
      {view.folders.length > 0 && (
        <section className="analyse-folders">
          <p className="muted small">Filter to specific folders (optional):</p>
          <div className="folder-checks">
            {view.folders.map((f) => (
              <label key={f.id} className="folder-check">
                <input
                  type="checkbox"
                  checked={selectedFolders.includes(f.id)}
                  onChange={() => toggleFolder(f.id)}
                />
                {f.id}
                <span className="muted small"> ({f.fileCount} file{f.fileCount === 1 ? "" : "s"}, ~{Math.round(f.tokenEstimate / 1000)}k tokens)</span>
              </label>
            ))}
          </div>
          {overLimit && (
            <p className="error" role="alert">
              The selected documents are too large for a single request (~{Math.round(estimatedTokens / 1000)}k tokens). Select fewer folders.
            </p>
          )}
        </section>
      )}

      {view.folders.length === 0 && (
        <p className="muted">No saved documents available for analysis.</p>
      )}

      <form className="analyse-form" onSubmit={ask}>
        <label htmlFor="analyse-question">Ask a question about this case</label>
        <textarea
          id="analyse-question"
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="e.g. Are the payslips covering the required period?"
          disabled={busy}
        />
        <button className="big" disabled={busy || overLimit || view.folders.length === 0}>
          {busy ? "Analysing…" : "Ask"}
        </button>
      </form>

      {result && (
        <div className="analyse-result" role="status" aria-live="polite">
          <p>{result.answer}</p>
          {result.claims.length > 0 && (
            <details className="analyse-claims">
              <summary className="muted small">{result.claims.length} citation{result.claims.length === 1 ? "" : "s"}</summary>
              <ul className="claims-list">
                {result.claims.map((c, i) => (
                  <li key={i}>
                    <span className="muted small">{c.kind === "guidance" ? "Guidance" : "Document"}</span>
                    <blockquote className="claim-quote">{c.quote}</blockquote>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {view.historyEnabled && view.history.length > 0 && (
        <section className="analyse-history">
          <h3>Previous questions</h3>
          {view.history.map((h) => (
            <div key={h.id} className="history-item">
              <div className="history-header">
                <strong className="small">{h.question}</strong>
                <span className="muted small"> — {h.askedBy}, {new Date(h.createdAt).toLocaleDateString("en-GB")}</span>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => deleteQ(h.id)}
                  aria-label="Delete this question"
                >
                  Delete
                </button>
              </div>
              <p className={h.notFound ? "muted small" : "small"}>{h.answer}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
