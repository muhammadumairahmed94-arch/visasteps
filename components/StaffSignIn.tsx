"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./ui";

type Step =
  | { kind: "password" }
  | { kind: "code"; recovery: boolean }
  | { kind: "enrol"; qrSvg?: string; secret?: string }
  | { kind: "recoveryCodes"; codes: string[] };

/** Caseworker sign-in: password, then a 6-digit code from an authenticator app (set up on first sign-in). */
export default function StaffSignIn({ onDone, initial }: { onDone: () => void; initial?: "enrol" | "code" }) {
  const [step, setStep] = useState<Step>(initial === "code" ? { kind: "code", recovery: false } : initial === "enrol" ? { kind: "enrol" } : { kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function post<T>(url: string, json?: unknown) {
    setBusy(true);
    setError(null);
    const r = await api<T>(url, { method: "POST", json });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      if (r.status === 401 || r.status === 429) setStep({ kind: "password" }); // session expired or locked: start again
    }
    return r;
  }

  // Arriving from "Set your password": the password step is done, go straight to the authenticator setup
  const started = useRef(false);
  useEffect(() => {
    if (initial !== "enrol" || started.current) return;
    started.current = true;
    api<{ qrSvg: string; secret: string }>("/api/auth/staff/2fa/enrol", { method: "POST" }).then((q) => (q.ok ? setStep({ kind: "enrol", ...q.data }) : setError(q.error)));
  }, [initial]);

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await post<{ next: "code" | "enrol" }>("/api/auth/staff/login", { email: f.get("email"), password: f.get("password") });
    if (!r.ok) return;
    if (r.data.next === "code") return setStep({ kind: "code", recovery: false });
    setStep({ kind: "enrol" });
    const q = await post<{ qrSvg: string; secret: string }>("/api/auth/staff/2fa/enrol");
    if (q.ok) setStep({ kind: "enrol", ...q.data });
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    const r = await post<{ ok?: true; recoveryCodes?: string[] }>("/api/auth/staff/2fa/verify", { code });
    if (!r.ok) return;
    if (r.data.recoveryCodes) setStep({ kind: "recoveryCodes", codes: r.data.recoveryCodes });
    else onDone();
  }

  const err = error && <p className="error" role="alert">{error}</p>;

  const codeField = (label: string, recovery = false) => (
    <div className="field">
      <label htmlFor="code">{label}</label>
      <input
        id="code"
        name="code"
        className={`input${recovery ? "" : " code"}`}
        inputMode={recovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        maxLength={recovery ? 20 : 6}
        placeholder={recovery ? "abcde-12345" : "123456"}
        autoFocus
        required
      />
    </div>
  );

  if (step.kind === "enrol")
    return (
      <>
        <section className="hello">
          <p className="eyebrow">One-time setup</p>
          <h1 data-focus tabIndex={-1}>Set up two-step sign-in</h1>
          <p>Client documents are sensitive, so caseworkers sign in with a password and a code from their phone.</p>
        </section>
        <ol className="steps">
          <li>Install <b>Microsoft Authenticator</b> or <b>Google Authenticator</b> on your phone.</li>
          <li>In the app, add an account and scan this code.</li>
        </ol>
        {step.qrSvg ? (
          <div className="qr" role="img" aria-label="QR code for the authenticator app" dangerouslySetInnerHTML={{ __html: step.qrSvg }} />
        ) : (
          <p className="muted" role="status">Preparing your code…</p>
        )}
        {step.secret && (
          <p className="muted">
            Cannot scan? Enter this key in the app instead: <span className="fn">{step.secret}</span>
          </p>
        )}
        <form className="detail" onSubmit={onCode} noValidate>
          {codeField("3. Enter the 6-digit code the app shows")}
          {err}
          <button className="big" disabled={busy || !step.qrSvg}>{busy ? "Checking…" : "Confirm and sign in"}</button>
        </form>
      </>
    );

  if (step.kind === "recoveryCodes")
    return (
      <>
        <section className="hello">
          <p className="eyebrow">Two-step sign-in is on</p>
          <h1 data-focus tabIndex={-1}>Save your recovery codes</h1>
          <p>If the phone is lost, each code below can be used once instead of the app. They will not be shown again.</p>
        </section>
        <ul className="recovery">
          {step.codes.map((c) => (
            <li key={c} className="fn">{c}</li>
          ))}
        </ul>
        <div className="detail">
          <button type="button" className="ghost" onClick={() => navigator.clipboard?.writeText(step.codes.join("\n"))}>Copy codes</button>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes somewhere safe
          </label>
          <button type="button" className="big" disabled={!saved} onClick={onDone}>Continue</button>
        </div>
      </>
    );

  if (step.kind === "code")
    return (
      <>
        <section className="hello">
          <h1 data-focus tabIndex={-1}>Enter your code</h1>
          <p>{step.recovery ? "Type one of the recovery codes saved when two-step sign-in was set up." : "Open the authenticator app and type the 6-digit code for UHA Legal."}</p>
        </section>
        <form className="detail" onSubmit={onCode} noValidate key={String(step.recovery)}>
          {codeField(step.recovery ? "Recovery code" : "6-digit code", step.recovery)}
          {err}
          <button className="big" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="link" onClick={() => (setError(null), setStep({ kind: "code", recovery: !step.recovery }))}>
            {step.recovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
          </button>
        </form>
      </>
    );

  return (
    <>
      <section className="hello">
        <h1 data-focus tabIndex={-1}>Caseworker sign in</h1>
      </section>
      <form className="detail" onSubmit={onPassword}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" className="input" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" required />
        </div>
        {err}
        <button className="big" disabled={busy}>{busy ? "Signing in…" : "Continue"}</button>
        <p className="privacy-link"><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy notice</a></p>
      </form>
    </>
  );
}
