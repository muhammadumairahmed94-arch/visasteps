"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./ui";

type Link = { kind: "SETUP" | "RESET"; email: string; firm: string };
type Step =
  | { kind: "checking" }
  | { kind: "signin"; notice?: string }
  | { kind: "forgot" }
  | { kind: "forgotSent"; email: string }
  | { kind: "setup"; link: Link }
  | { kind: "reset"; link: Link };

const values = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;

/**
 * Client sign-in with email + password. A link from an email (token) opens either
 * "Create account" (first time) or "Choose a new password" (forgot password).
 */
export default function ClientSignIn({ token, onDone }: { token?: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>(token ? { kind: "checking" } : { kind: "signin" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (!token || checked.current) return;
    checked.current = true;
    api<Link>("/api/auth/client/link", { method: "POST", json: { token } }).then((r) => {
      if (!r.ok) setStep({ kind: "signin", notice: "This link has expired or has already been used. Sign in below, or contact us for a new link." });
      else setStep(r.data.kind === "SETUP" ? { kind: "setup", link: r.data } : { kind: "reset", link: r.data });
    });
  }, [token]);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  async function submit(url: string, payload: Record<string, string>, after: () => void) {
    setBusy(true);
    setError(null);
    const r = await api(url, { method: "POST", json: payload });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    after();
  }

  const err = error && (
    <p id="err" className="error" role="alert">
      {error}
    </p>
  );

  if (step.kind === "checking") return <p className="muted" role="status">Opening link…</p>;

  if (step.kind === "setup")
    return (
      <>
        <section className="hello">
          <p className="eyebrow">{step.link.firm}</p>
          <h1 data-focus tabIndex={-1}>Create account</h1>
          <p>Secure access for uploading visa documents.</p>
        </section>
        <form className="detail" noValidate onSubmit={(e) => (e.preventDefault(), submit("/api/auth/client/setup", { ...values(e), token: token! }, onDone))}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" value={step.link.email} readOnly autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" className="input" autoComplete="given-name" required />
          </div>
          <div className="field">
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" className="input" autoComplete="family-name" required />
          </div>
          <div className="field">
            <label htmlFor="mobile">
              Mobile number <span className="optional">(optional)</span>
            </label>
            <input id="mobile" name="mobile" className="input" type="tel" inputMode="tel" autoComplete="tel" aria-describedby="mobile-hint" />
            <p id="mobile-hint" className="hint">Used for text updates about documents.</p>
          </div>
          <Password label="Choose a password" autoComplete="new-password" hint="At least 8 characters." />
          {err}
          <button className="big" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
      </>
    );

  if (step.kind === "reset")
    return (
      <>
        <section className="hello">
          <p className="eyebrow">{step.link.firm}</p>
          <h1 data-focus tabIndex={-1}>Choose a new password</h1>
          <p>For {step.link.email}</p>
        </section>
        <form className="detail" noValidate onSubmit={(e) => (e.preventDefault(), submit("/api/auth/client/setup", { ...values(e), token: token! }, onDone))}>
          <input type="hidden" name="username" value={step.link.email} autoComplete="username" />
          <Password label="New password" autoComplete="new-password" hint="At least 8 characters." />
          {err}
          <button className="big" disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</button>
        </form>
      </>
    );

  if (step.kind === "forgot")
    return (
      <>
        <section className="hello">
          <h1 data-focus tabIndex={-1}>Reset password</h1>
          <p>A reset link will be sent by email.</p>
        </section>
        <form
          className="detail"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const { email } = values(e);
            submit("/api/auth/client/forgot", { email }, () => go({ kind: "forgotSent", email }));
          }}
        >
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" className="input" type="email" autoComplete="email" required />
          </div>
          {err}
          <button className="big" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <button type="button" className="link" onClick={() => go({ kind: "signin" })}>Back to sign in</button>
        </form>
      </>
    );

  if (step.kind === "forgotSent")
    return (
      <>
        <section className="hello">
          <h1 data-focus tabIndex={-1}>Email sent</h1>
        </section>
        <div className="detail">
          <p className="why">
            If an account exists for <b>{step.email}</b>, a reset link has been sent. It is valid for 1 hour.
          </p>
          <p className="muted">Not received? Check the spam or junk folder.</p>
          <button type="button" className="ghost" onClick={() => go({ kind: "signin" })}>Back to sign in</button>
        </div>
      </>
    );

  return (
    <>
      <section className="hello">
        <h1 data-focus tabIndex={-1}>Client sign in</h1>
        <p>Upload and track visa documents securely.</p>
      </section>
      <form className="detail" noValidate onSubmit={(e) => (e.preventDefault(), submit("/api/auth/client/login", values(e), onDone))}>
        {step.notice && <p className="note">{step.notice}</p>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" className="input" type="email" autoComplete="username" required />
        </div>
        <Password label="Password" autoComplete="current-password" />
        {err}
        <button className="big" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button type="button" className="link" onClick={() => go({ kind: "forgot" })}>Forgot password?</button>
        <p className="muted">New client? Use the invitation link sent by email to create an account.</p>
      </form>
    </>
  );
}

/** Password box with a Show / Hide button, so clients can check what they typed. */
function Password({ label, autoComplete, hint }: { label: string; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor="password">{label}</label>
      <div className="pw">
        <input
          id="password"
          name="password"
          className="input"
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          required
          aria-describedby={hint ? "pw-hint" : undefined}
        />
        <button type="button" className="pw-toggle" aria-pressed={show} aria-controls="password" onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {hint && <p id="pw-hint" className="hint">{hint}</p>}
    </div>
  );
}
