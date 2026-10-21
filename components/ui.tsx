"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type Status = "NEED" | "SENT" | "OK" | "REDO";

export const CLIENT_LABEL: Record<Status, string> = { NEED: "To do", SENT: "Checking", OK: "Done", REDO: "Please redo" };
export const STAFF_LABEL: Record<Status, string> = { NEED: "Missing", SENT: "To review", OK: "Approved", REDO: "Asked again" };

const cls = (s: Status) => s.toLowerCase();

export function Row({ status, labels, onClick, children }: { status: Status; labels: Record<Status, string>; onClick?: () => void; children: ReactNode }) {
  const inner = (
    <>
      <span className={`dot d-${cls(status)}`} aria-hidden="true" />
      <span className="t">{children}</span>
      <span className={`pill p-${cls(status)}`}>{labels[status]}</span>
      {onClick && <span className="chev" aria-hidden="true">›</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="row">{inner}</div>
  );
}

export function StatusPill({ status, labels }: { status: Status; labels: Record<Status, string> }) {
  return (
    <p className={`pill p-${cls(status)}`} style={{ alignSelf: "flex-start" }}>
      {labels[status]}
    </p>
  );
}

/** Tab strip with arrow-key support. Panels are rendered by the caller with id `panel`. */
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: [K, string][]; value: K; onChange: (k: K) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n][0]);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([k, l], i) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${k}`}
          aria-selected={value === k}
          aria-controls="panel"
          tabIndex={value === k ? 0 : -1}
          onClick={() => onChange(k)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3500);
  }, []);
  const node = (
    <div className="toast" role="status" hidden={!msg}>
      {msg}
    </div>
  );
  return [show, node] as const;
}

/**
 * Screen state kept in the URL hash, so the phone's Back button walks back through
 * tiles → list → document instead of leaving the portal.
 */
export function useHashView<T>(parse: (hash: string) => T, format: (v: T) => string) {
  const [view, setView] = useState<T>(() => parse(""));
  const moved = useRef(false);
  useEffect(() => {
    const read = () => setView(parse(decodeURIComponent(location.hash.slice(1))));
    const onPop = () => {
      moved.current = true;
      read();
    };
    read();
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
    // parse is stable per component
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // After a move, put focus on the new screen's heading so screen readers announce it
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    scrollTo(0, 0);
    document.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
  }, [view]);
  const go = useCallback(
    (v: T) => {
      history.pushState(null, "", "#" + format(v));
      moved.current = true;
      setView(v);
    },
    [format],
  );
  return [view, go] as const;
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const { json, ...rest } = init ?? {};
  try {
    const res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: data as T } : { ok: false, status: res.status, error: data.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, status: 0, error: "No internet connection. Please try again." };
  }
}

/** UHA Legal masthead (charcoal band, white monogram) + the single reading column. */
export function Page({ label = "Client Portal", right, children }: { label?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <span className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/uha-logo.png" alt="UHA Legal" className="logo" width={480} height={289} />
            <span className="portal-label">{label}</span>
          </span>
          {right}
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="foot">
        <p>UHA Legal · UK immigration lawyers · <a href="https://www.uhalegal.com">uhalegal.com</a></p>
      </footer>
    </>
  );
}
