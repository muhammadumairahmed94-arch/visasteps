"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { GuidanceView, GuidanceRouteView, GuidanceSourceView } from "@/lib/guidance";
import { Tabs, api } from "./ui";

type RouteTab = string; // route id

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── main panel ──────────────────────────────────────────────────────────── */

export default function GuidancePanel({ onBack, toast }: { onBack: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<GuidanceView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<GuidanceView>("/api/staff/guidance").then((r) => {
        if (!r.ok) { setLoadError(r.error); return; }
        setData(r.data);
        setRouteId((id) => id ?? r.data.routes[0]?.id ?? null);
      }),
    [],
  );

  useEffect(() => { void load(); }, [load]);

  if (loadError) return (
    <>
      <button type="button" className="back" onClick={onBack}>← Clients</button>
      <p className="error" role="alert">{loadError}</p>
    </>
  );

  if (!data) return (
    <>
      <button type="button" className="back" onClick={onBack}>← Clients</button>
      <p className="muted" role="status">Loading…</p>
    </>
  );

  const route = data.routes.find((r) => r.id === routeId) ?? data.routes[0] ?? null;

  return (
    <>
      <button type="button" className="back" onClick={onBack}>← Clients</button>
      <section className="hello">
        <h1 data-focus tabIndex={-1}>Guidance library</h1>
        <p>Official guidance from gov.uk for visa routes.</p>
      </section>

      {data.routes.length === 0 ? (
        <p className="muted">No visa routes set up yet. Add routes in Admin → Checklists.</p>
      ) : (
        <>
          <Tabs<RouteTab>
            label="Visa routes"
            tabs={data.routes.map((r) => [r.id, r.name])}
            value={routeId ?? data.routes[0].id}
            onChange={setRouteId}
          />
          {route && (
            <RoutePanel
              route={route}
              isAdmin={data.isAdmin}
              allAdmins={data.allAdmins}
              reviewMonths={data.reviewMonths}
              onRefresh={load}
              toast={toast}
            />
          )}
        </>
      )}
    </>
  );
}

/* ── per-route panel ─────────────────────────────────────────────────────── */

function RoutePanel({
  route,
  isAdmin,
  allAdmins,
  reviewMonths,
  onRefresh,
  toast,
}: {
  route: GuidanceRouteView;
  isAdmin: boolean;
  allAdmins: GuidanceView["allAdmins"];
  reviewMonths: number;
  onRefresh: () => Promise<void>;
  toast: (m: string) => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [supersedeTarget, setSupersedeTarget] = useState<string | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (url: string, opts: RequestInit) => {
    setBusy(true);
    const r = await api<{ message?: string }>(url, opts);
    setBusy(false);
    if (!r.ok) { toast(r.error); return false; }
    if (r.data.message) toast(r.data.message);
    await onRefresh();
    return true;
  };

  const { covered, total } = route.coverage;
  const coveragePill =
    total === 0
      ? null
      : covered === total
        ? <span className="pill p-ok">{covered} of {total} types covered</span>
        : <span className="pill p-sent">{covered} of {total} types covered</span>;

  return (
    <div className="stack">

      {/* Coverage + owner */}
      <section className="detail card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>{route.name}</h2>
          {coveragePill}
        </div>
        <p className="muted" style={{ marginTop: "0.25rem" }}>
          {total === 0 ? "No expected source types defined." : `${total} expected source type${total === 1 ? "" : "s"} defined.`}
        </p>
        <OwnerSection route={route} isAdmin={isAdmin} allAdmins={allAdmins} busy={busy} run={run} />
      </section>

      {/* Expected source types */}
      <section className="detail card">
        <h2>Expected source types</h2>
        {route.expectedTypes.length === 0 ? (
          <p className="muted">None defined. {isAdmin && "Add types below to track coverage."}</p>
        ) : (
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            {route.expectedTypes.map((t) => {
              const isCovered = route.activeSources.some((s) => s.typeId === t.id);
              return (
                <li key={t.id} style={{ marginBottom: "0.25rem" }}>
                  <span>{t.name}</span>
                  {isCovered
                    ? <span className="pill p-ok" style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}>Covered</span>
                    : <span className="pill" style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}>Missing</span>
                  }
                  {isAdmin && (
                    <button
                      type="button"
                      className="link"
                      style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "var(--danger, #c00)" }}
                      disabled={busy}
                      onClick={() => confirm(`Remove "${t.name}"? Sources tagged with this type will keep their data.`) &&
                        run(`/api/admin/guidance/types/${t.id}`, { method: "DELETE" })}
                    >
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && !showAddType && (
          <button type="button" className="ghost" onClick={() => setShowAddType(true)}>+ Add source type</button>
        )}
        {isAdmin && showAddType && (
          <AddTypeForm
            busy={busy}
            onSave={async (name) => {
              if (await run("/api/admin/guidance/types", { method: "POST", body: JSON.stringify({ routeId: route.id, name }), headers: { "Content-Type": "application/json" } })) {
                setShowAddType(false);
              }
            }}
            onCancel={() => setShowAddType(false)}
          />
        )}
      </section>

      {/* Active sources */}
      <section className="detail card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Active sources ({route.activeSources.length})</h2>
          {isAdmin && !showUpload && (
            <button type="button" className="ghost" onClick={() => { setShowUpload(true); setSupersedeTarget(null); }}>
              Upload source
            </button>
          )}
        </div>

        {showUpload && supersedeTarget === null && (
          <UploadForm
            routeId={route.id}
            types={route.expectedTypes}
            label="Upload new source"
            endpoint="/api/admin/guidance"
            busy={busy}
            setBusy={setBusy}
            onSave={async () => { setShowUpload(false); await onRefresh(); }}
            onCancel={() => setShowUpload(false)}
            toast={toast}
          />
        )}

        {route.activeSources.length === 0 && !showUpload && (
          <p className="muted">No active sources yet. {isAdmin && "Upload one above."}</p>
        )}

        {route.activeSources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            isAdmin={isAdmin}
            types={route.expectedTypes}
            reviewMonths={reviewMonths}
            showingSupersedeForm={supersedeTarget === source.id}
            busy={busy}
            setBusy={setBusy}
            onRefresh={onRefresh}
            toast={toast}
            onStartSupersede={() => { setSupersedeTarget(source.id); setShowUpload(false); }}
            onCancelSupersede={() => setSupersedeTarget(null)}
            onMarkReviewed={() => run(`/api/admin/guidance/${source.id}/review`, { method: "POST" })}
          />
        ))}
      </section>

      {/* Superseded sources */}
      {route.supersededSources.length > 0 && (
        <section className="detail card">
          <button
            type="button"
            className="row"
            onClick={() => setShowSuperseded((v) => !v)}
            aria-expanded={showSuperseded}
            style={{ width: "100%", textAlign: "left" }}
          >
            <span className="t">Archived versions ({route.supersededSources.length})</span>
            <span className="chev" aria-hidden="true">{showSuperseded ? "⌄" : "›"}</span>
          </button>
          {showSuperseded && route.supersededSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              isAdmin={false}
              types={route.expectedTypes}
              reviewMonths={reviewMonths}
              showingSupersedeForm={false}
              busy={busy}
              setBusy={setBusy}
              onRefresh={onRefresh}
              toast={toast}
              onStartSupersede={() => undefined}
              onCancelSupersede={() => undefined}
              onMarkReviewed={() => Promise.resolve(false)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/* ── owner section ───────────────────────────────────────────────────────── */

function OwnerSection({
  route,
  isAdmin,
  allAdmins,
  busy,
  run,
}: {
  route: GuidanceRouteView;
  isAdmin: boolean;
  allAdmins: GuidanceView["allAdmins"];
  busy: boolean;
  run: (url: string, opts: RequestInit) => Promise<boolean>;
}) {
  if (!isAdmin) {
    return (
      <p style={{ marginTop: "0.5rem" }}>
        <strong>Owner: </strong>
        {route.owner ? route.owner.name : <span className="muted">Not assigned</span>}
      </p>
    );
  }

  return (
    <div className="field" style={{ marginTop: "0.75rem" }}>
      <label htmlFor={`owner-${route.id}`}>Guidance owner (admin responsible for keeping this current)</label>
      <select
        id={`owner-${route.id}`}
        className="input"
        value={route.owner?.id ?? ""}
        disabled={busy}
        onChange={(e) =>
          run(`/api/admin/routes/${route.id}/guidance-owner`, {
            method: "PATCH",
            body: JSON.stringify({ userId: e.target.value || null }),
            headers: { "Content-Type": "application/json" },
          })
        }
      >
        <option value="">— Not assigned —</option>
        {allAdmins.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
  );
}

/* ── source card ─────────────────────────────────────────────────────────── */

function SourceCard({
  source,
  isAdmin,
  types,
  reviewMonths,
  showingSupersedeForm,
  busy,
  setBusy,
  onRefresh,
  toast,
  onStartSupersede,
  onCancelSupersede,
  onMarkReviewed,
}: {
  source: GuidanceSourceView;
  isAdmin: boolean;
  types: GuidanceRouteView["expectedTypes"];
  reviewMonths: number;
  showingSupersedeForm: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  toast: (m: string) => void;
  onStartSupersede: () => void;
  onCancelSupersede: () => void;
  onMarkReviewed: () => Promise<boolean>;
}) {
  const typeName = types.find((t) => t.id === source.typeId)?.name;
  const isHtml = source.mimeType === "text/html";

  return (
    <div style={{ borderTop: "1px solid var(--border, #e5e5e5)", marginTop: "0.75rem", paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ flex: 1 }}>
          <strong>{source.title}</strong>
          {typeName && <span className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>({typeName})</span>}
          {source.status === "SUPERSEDED" && (
            <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--muted, #666)" }}>
              Superseded on {fmtDate(source.supersededBy?.uploadedAt ?? source.uploadedAt)}
              {source.supersededBy && <> — replaced by &ldquo;{source.supersededBy.title}&rdquo;</>}
            </p>
          )}
          {source.stale && (
            <p className="error" style={{ marginTop: "0.25rem", fontSize: "0.85rem" }}>
              ⚠ Last checked over {reviewMonths} month{reviewMonths === 1 ? "" : "s"} ago —{" "}
              <a href={source.govukUrl} target="_blank" rel="noopener noreferrer">check gov.uk for a newer version</a>.
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Uploaded {fmtDate(source.uploadedAt)} by {source.uploadedBy} · {fmtBytes(source.sizeBytes)}
            {source.publishedAt && ` · Published ${fmtDate(source.publishedAt)}`}
            {source.lastUpdatedAt && ` · Gov.uk updated ${fmtDate(source.lastUpdatedAt)}`}
          </p>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            {source.lastReviewedAt
              ? `Last reviewed ${fmtDate(source.lastReviewedAt)} by ${source.lastReviewedBy ?? "unknown"}`
              : "Never reviewed"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
          <a
            href={`/api/staff/guidance/${source.id}`}
            target={isHtml ? undefined : "_blank"}
            rel={isHtml ? undefined : "noopener noreferrer"}
            className="ghost"
            style={{ fontSize: "0.85rem" }}
            download={isHtml ? source.fileName : undefined}
          >
            {isHtml ? "Download" : "Open PDF"}
          </a>
          <a href={source.govukUrl} target="_blank" rel="noopener noreferrer" className="ghost" style={{ fontSize: "0.85rem" }}>
            gov.uk ↗
          </a>
        </div>
      </div>

      {isAdmin && source.status === "ACTIVE" && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            className="ghost"
            style={{ fontSize: "0.85rem" }}
            disabled={busy}
            onClick={() => onMarkReviewed()}
          >
            Mark reviewed
          </button>
          <button
            type="button"
            className="ghost"
            style={{ fontSize: "0.85rem" }}
            disabled={busy}
            onClick={showingSupersedeForm ? onCancelSupersede : onStartSupersede}
          >
            {showingSupersedeForm ? "Cancel" : "Upload new version"}
          </button>
        </div>
      )}

      {showingSupersedeForm && (
        <UploadForm
          routeId={null}
          types={types}
          label={`Upload new version of "${source.title}"`}
          endpoint={`/api/admin/guidance/${source.id}/supersede`}
          busy={busy}
          setBusy={setBusy}
          onSave={async () => { onCancelSupersede(); await onRefresh(); }}
          onCancel={onCancelSupersede}
          toast={toast}
          defaultTitle={source.title}
          defaultGovukUrl={source.govukUrl}
          defaultTypeId={source.typeId ?? undefined}
        />
      )}
    </div>
  );
}

/* ── upload / supersede form ─────────────────────────────────────────────── */

function UploadForm({
  routeId,
  types,
  label,
  endpoint,
  busy,
  setBusy,
  onSave,
  onCancel,
  toast,
  defaultTitle = "",
  defaultGovukUrl = "",
  defaultTypeId,
}: {
  routeId: string | null;
  types: GuidanceRouteView["expectedTypes"];
  label: string;
  endpoint: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
  toast: (m: string) => void;
  defaultTitle?: string;
  defaultGovukUrl?: string;
  defaultTypeId?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const fileInput = fileRef.current;
    if (!fileInput?.files?.[0]) { setError("Please choose a file."); return; }

    setError(null);
    setBusy(true);

    const form = new FormData(el);
    // Ensure mimeType is set for the file
    form.set("file", fileInput.files[0]);
    if (routeId) form.append("routeIds", routeId);

    const r = await api<{ message?: string }>(endpoint, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    if (r.data.message) toast(r.data.message);
    await onSave();
  }

  return (
    <form className="detail card" onSubmit={submit} style={{ marginTop: "0.75rem" }}>
      <h3>{label}</h3>

      <div className="field">
        <label htmlFor="uf-title">Title</label>
        <input id="uf-title" name="title" className="input" required defaultValue={defaultTitle} maxLength={200} />
      </div>

      <div className="field">
        <label htmlFor="uf-url">gov.uk URL</label>
        <input id="uf-url" name="govukUrl" type="url" className="input" required defaultValue={defaultGovukUrl} aria-describedby="uf-url-hint" />
        <p id="uf-url-hint" className="hint">Must be from a gov.uk address.</p>
      </div>

      <div className="field">
        <label htmlFor="uf-pub">Published date (optional)</label>
        <input id="uf-pub" name="publishedAt" type="date" className="input" />
      </div>

      <div className="field">
        <label htmlFor="uf-upd">Last updated on gov.uk (optional)</label>
        <input id="uf-upd" name="lastUpdatedAt" type="date" className="input" />
      </div>

      {types.length > 0 && (
        <div className="field">
          <label htmlFor="uf-type">Source type (optional)</label>
          <select id="uf-type" name="typeId" className="input" defaultValue={defaultTypeId ?? ""}>
            <option value="">— None —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="uf-file">File (PDF or HTML, max 50 MB)</label>
        <input id="uf-file" name="file" type="file" accept=".pdf,.html,.htm" required ref={fileRef} className="input" aria-describedby="uf-file-hint" />
        <p id="uf-file-hint" className="hint">Best: on the gov.uk page, use Print → Save as PDF. HTML files can be downloaded but not opened in the browser.</p>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="big" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

/* ── add type form ───────────────────────────────────────────────────────── */

function AddTypeForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }} role="form" aria-label="Add source type">
      <input
        type="text"
        className="input"
        placeholder="e.g. Main route appendix"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        className="big"
        disabled={busy || name.trim().length < 2}
        onClick={() => onSave(name.trim())}
      >
        Add
      </button>
      <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  );
}
