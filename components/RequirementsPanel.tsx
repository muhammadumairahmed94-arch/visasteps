"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequirementsView, RequirementsRouteView } from "@/lib/requirements";
import { api } from "./ui";

type RequirementRow = RequirementsRouteView["approved"][number];
type SuggestionRow = RequirementsRouteView["suggestions"][number];

const RULE_LABELS: Record<string, string> = {
  DATE_LIMIT: "Date limit",
  MONEY_THRESHOLD: "Money threshold",
  DOCUMENT_PRESENT: "Document required",
  NAME_MATCH: "Name match",
  OTHER: "Other",
};

interface Props {
  onBack: () => void;
  toast: (msg: string) => void;
}

export default function RequirementsPanel({ onBack, toast }: Props) {
  const [view, setView] = useState<RequirementsView | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  const load = useCallback(() =>
    api<RequirementsView>("/api/staff/requirements").then((r) => {
      if (r.ok) setView(r.data);
    }),
  []);

  useEffect(() => { void load(); }, [load]);

  if (!view) return <div className="spinner" aria-label="Loading" />;

  // Resolve: use the selected tab, or the first route if none selected yet
  const resolvedId = activeRouteId ?? view.routes[0]?.id ?? null;
  const route = view.routes.find((r) => r.id === resolvedId) ?? view.routes[0];

  return (
    <div className="panel">
      <div className="panel-header">
        <button type="button" className="back" onClick={onBack}>← Back</button>
        <h1>Requirements</h1>
      </div>

      {view.routes.length > 1 && (
        <div className="tab-row" role="tablist">
          {view.routes.map((r) => (
            <button
              key={r.id}
              role="tab"
              aria-selected={r.id === activeRouteId}
              type="button"
              className={r.id === activeRouteId ? "tab active" : "tab"}
              onClick={() => setActiveRouteId(r.id)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {route && (
        <RouteSection
          key={route.id}
          route={route}
          isAdmin={view.isAdmin}
          onRefresh={load}
          toast={toast}
        />
      )}
    </div>
  );
}

function RouteSection({ route, isAdmin, onRefresh, toast }: {
  route: RequirementsRouteView;
  isAdmin: boolean;
  onRefresh: () => void;
  toast: (msg: string) => void;
}) {
  return (
    <div className="route-section">
      {isAdmin && (
        <DraftControls route={route} onRefresh={onRefresh} toast={toast} />
      )}

      {isAdmin && route.draft.length > 0 && (
        <section>
          <h2>Pending review ({route.draft.length})</h2>
          {route.draft.map((req) => (
            <DraftRequirementCard key={req.id} req={req} onRefresh={onRefresh} toast={toast} />
          ))}
        </section>
      )}

      {route.approved.length > 0 && (
        <section>
          <h2>Approved requirements ({route.approved.length})</h2>
          {route.approved.map((req) => (
            <RequirementCard key={req.id} req={req} />
          ))}
        </section>
      )}

      {isAdmin && route.mentionedSources.length > 0 && (
        <section>
          <h2>Mentioned but not uploaded ({route.mentionedSources.length})</h2>
          <p className="muted small">These guidance documents were referenced in your sources but are not in the library.</p>
          <ul className="mentioned-list">
            {route.mentionedSources.map((m) => (
              <li key={m.id}>
                <strong>{m.title}</strong>
                {m.url && <> — <a href={m.url} target="_blank" rel="noreferrer">{m.url}</a></>}
                <span className="muted"> (found at: {m.locator})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && route.suggestions.length > 0 && (
        <section>
          <h2>Suggested checklist changes ({route.suggestions.length})</h2>
          <p className="muted small">From approved requirements — accept to add to the checklist, or ignore.</p>
          {route.suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onRefresh={onRefresh} toast={toast} />
          ))}
        </section>
      )}

      {route.approved.length === 0 && route.draft.length === 0 && route.mentionedSources.length === 0 && route.suggestions.length === 0 && !route.latestRun && (
        <p className="muted">No requirements yet for {route.name}.</p>
      )}
    </div>
  );
}

function DraftControls({ route, onRefresh, toast }: {
  route: RequirementsRouteView;
  onRefresh: () => void;
  toast: (msg: string) => void;
}) {
  const [drafting, setDrafting] = useState(false);

  async function startDraft() {
    setDrafting(true);
    const r = await api("/api/admin/requirements/generate", { method: "POST", json: { routeId: route.id } });
    if (!r.ok) {
      toast(r.error);
      setDrafting(false);
      return;
    }
    toast("Draft run started.");
    onRefresh();
  }

  const run = route.latestRun;
  const isRunning = run?.status === "QUEUED" || run?.status === "RUNNING";

  return (
    <div className="draft-controls">
      <button
        type="button"
        className="ghost"
        onClick={startDraft}
        disabled={drafting || isRunning}
      >
        {isRunning ? "Drafting…" : "Draft requirements"}
      </button>

      {run && (
        <div className="run-status" role="status" aria-live="polite">
          <span className={`pill run-${run.status.toLowerCase()}`}>{run.status}</span>
          <span className="muted small"> by {run.initiatedBy}</span>
          {run.sources.map((s) => (
            <div key={s.id} className="source-progress">
              <span>{s.title}</span>
              <span className={`pill src-${s.status.toLowerCase()}`}>{s.status}</span>
              {s.status === "DONE" && <span className="muted"> {s.requirementsFound} found</span>}
              {s.status === "FAILED" && (
                <>
                  <span className="muted small"> {s.errorMessage}</span>
                  <RetryButton sourceId={s.id} runId={run.id} onRefresh={onRefresh} toast={toast} />
                </>
              )}
              {s.status === "NO_TEXT" && (
                <>
                  <span className="muted small"> No text found — upload a text PDF</span>
                  <RetryButton sourceId={s.id} runId={run.id} onRefresh={onRefresh} toast={toast} />
                </>
              )}
            </div>
          ))}

          {run.rejectedDrafts.length > 0 && (
            <details className="rejected-drafts">
              <summary className="muted small">
                {run.rejectedDrafts.length} draft{run.rejectedDrafts.length === 1 ? "" : "s"} rejected — expand to review
              </summary>
              <ul className="rejected-list">
                {run.rejectedDrafts.map((r) => (
                  <li key={r.id}>
                    <strong>{r.whatIsChecked}</strong>
                    <span className="muted small"> — {r.reason}</span>
                    <span className="muted small"> (cited: {r.citationLocator})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function RetryButton({ sourceId, runId, onRefresh, toast }: {
  sourceId: string;
  runId: string;
  onRefresh: () => void;
  toast: (msg: string) => void;
}) {
  async function retry() {
    const r = await api(`/api/admin/requirements/runs/${runId}/sources/${sourceId}/retry`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error); return; }
    toast("Retry queued.");
    onRefresh();
  }
  return <button type="button" className="ghost small" onClick={retry}>Retry</button>;
}

function RequirementCard({ req }: { req: RequirementRow }) {
  return (
    <div className="req-card">
      <div className="req-header">
        <span className="req-rule">{RULE_LABELS[req.ruleType] ?? req.ruleType}</span>
        <strong>{req.whatIsChecked}</strong>
        {req.limitOrThreshold && <span className="muted"> — {req.limitOrThreshold}</span>}
      </div>
      <p className="req-evidence">{req.evidenceNeeded}</p>
      <blockquote className="req-quote">
        <span>{req.citationQuote}</span>
        <cite>
          {req.citationSource.title}, {req.citationLocator}
        </cite>
      </blockquote>
      {req.reviewedBy && <p className="muted small">Approved by {req.reviewedBy}</p>}
    </div>
  );
}

function DraftRequirementCard({ req, onRefresh, toast }: {
  req: RequirementRow;
  onRefresh: () => void;
  toast: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [whatIsChecked, setWhatIsChecked] = useState(req.whatIsChecked);
  const [evidenceNeeded, setEvidenceNeeded] = useState(req.evidenceNeeded);
  const [ruleType, setRuleType] = useState(req.ruleType);

  async function act(action: "approve" | "reject") {
    const r = await api(`/api/admin/requirements/${req.id}`, {
      method: "PATCH",
      json: {
        action,
        whatIsChecked: editing ? whatIsChecked : undefined,
        evidenceNeeded: editing ? evidenceNeeded : undefined,
        ruleType: editing ? ruleType : undefined,
      },
    });
    if (!r.ok) { toast(r.error); return; }
    toast(action === "approve" ? "Requirement approved." : "Requirement rejected.");
    onRefresh();
  }

  return (
    <div className="req-card req-draft">
      {editing ? (
        <div className="req-edit">
          <label>
            Rule type
            <select value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
              {Object.entries(RULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>
            What is checked
            <input value={whatIsChecked} onChange={(e) => setWhatIsChecked(e.target.value)} />
          </label>
          <label>
            Evidence needed
            <textarea value={evidenceNeeded} onChange={(e) => setEvidenceNeeded(e.target.value)} rows={3} />
          </label>
        </div>
      ) : (
        <>
          <div className="req-header">
            <span className="req-rule">{RULE_LABELS[req.ruleType] ?? req.ruleType}</span>
            <strong>{req.whatIsChecked}</strong>
            {req.limitOrThreshold && <span className="muted"> — {req.limitOrThreshold}</span>}
          </div>
          <p className="req-evidence">{req.evidenceNeeded}</p>
        </>
      )}
      <blockquote className="req-quote">
        <span>{req.citationQuote}</span>
        <cite>{req.citationSource.title}, {req.citationLocator}</cite>
      </blockquote>
      <div className="req-actions">
        <button type="button" className="ghost small" onClick={() => setEditing((e) => !e)}>
          {editing ? "Cancel" : "Edit"}
        </button>
        <button type="button" className="approve" onClick={() => act("approve")}>Approve</button>
        <button type="button" className="ghost small" onClick={() => act("reject")}>Reject</button>
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion, onRefresh, toast }: {
  suggestion: SuggestionRow;
  onRefresh: () => void;
  toast: (msg: string) => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [form, setForm] = useState({
    folder: "01 Identity",
    groupLabel: "Identity",
    title: suggestion.documentName,
    why: suggestion.description ?? "",
    typeKey: suggestion.documentName.replace(/[^a-zA-Z0-9]/g, "-"),
    required: true,
    assignedTo: "CLIENT" as "CLIENT" | "SPONSOR",
  });

  async function accept() {
    const r = await api(`/api/admin/checklist-suggestions/${suggestion.id}/accept`, { method: "POST", json: form });
    if (!r.ok) { toast(r.error); return; }
    toast("Added to checklist.");
    onRefresh();
  }

  async function ignore() {
    const r = await api(`/api/admin/checklist-suggestions/${suggestion.id}/ignore`, { method: "POST", json: {} });
    if (!r.ok) { toast(r.error); return; }
    toast("Suggestion ignored.");
    onRefresh();
  }

  return (
    <div className="suggestion-card">
      <div>
        <strong>{suggestion.documentName}</strong>
        {suggestion.description && <p className="muted small">{suggestion.description}</p>}
        <p className="muted small">From requirement: {suggestion.whatIsChecked}</p>
      </div>
      {accepting ? (
        <div className="suggestion-form">
          <label>Folder <input value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} /></label>
          <label>Group label <input value={form.groupLabel} onChange={(e) => setForm({ ...form, groupLabel: e.target.value })} /></label>
          <label>Title <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>Why needed <textarea value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} rows={2} /></label>
          <label>Type key <input value={form.typeKey} onChange={(e) => setForm({ ...form, typeKey: e.target.value })} /></label>
          <label>
            Assigned to
            <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value as "CLIENT" | "SPONSOR" })}>
              <option value="CLIENT">Client</option>
              <option value="SPONSOR">Sponsor</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
            Required
          </label>
          <div className="suggestion-actions">
            <button type="button" className="approve" onClick={accept}>Add to checklist</button>
            <button type="button" className="ghost small" onClick={() => setAccepting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="suggestion-actions">
          <button type="button" className="ghost" onClick={() => setAccepting(true)}>Accept</button>
          <button type="button" className="ghost small" onClick={ignore}>Ignore</button>
        </div>
      )}
    </div>
  );
}
