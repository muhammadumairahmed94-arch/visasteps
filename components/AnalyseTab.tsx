"use client";

import { useState, type FormEvent } from "react";
import type { AnalysisView } from "@/lib/case-analysis";
import type { AiCaseClaim } from "@/lib/adapters/ai";
import { api } from "./ui";

interface Props {
  clientId: string;
  view: AnalysisView;
  onRefresh: () => void;
  toast: (msg: string) => void;
}

export default function AnalyseTab({ clientId, view, onRefresh, toast }: Props) {
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ answer: string; claims: AiCaseClaim[]; notFound: boolean } | null>(null);

  const foldersToUse = selectedFolders.length > 0 ? selectedFolders : undefined;

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

  return (
    <div className="analyse-tab">
      <h2 data-focus tabIndex={-1}>Analyse</h2>

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
