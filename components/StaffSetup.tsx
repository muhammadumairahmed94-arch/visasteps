"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import StaffSignIn from "./StaffSignIn";
import { Page, api } from "./ui";

type Info = { name: string; email: string; firm: string };

/** New caseworker: choose a password, then set up the authenticator app (StaffSignIn takes over). */
export default function StaffSetup({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [next, setNext] = useState<"enrol" | "code" | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    api<Info>("/api/auth/staff/setup", { method: "POST", json: { token } }).then((r) => (r.ok ? setInfo(r.data) : setError(r.error)));
  }, [token]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const r = await api<{ next: "enrol" | "code" }>("/api/auth/staff/setup", { method: "POST", json: { token, password } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    history.replaceState(null, "", "/staff");
    setNext(r.data.next);
  }

  if (next)
    return (
      <Page label="Caseworker">
        <StaffSignIn initial={next} onDone={() => location.replace("/staff")} />
      </Page>
    );

  return (
    <Page label="Caseworker">
      <section className="hello">
        {info && <p className="eyebrow">{info.firm}</p>}
        <h1 data-focus tabIndex={-1}>Set your password</h1>
        {info && <p>For {info.email}</p>}
      </section>
      {!info && !error && <p className="muted" role="status">Opening link…</p>}
      {error && !info && (
        <>
          <p className="error" role="alert">{error}</p>
          <a className="link" href="/staff">Go to caseworker sign in</a>
        </>
      )}
      {info && (
        <form className="detail" onSubmit={submit} noValidate>
          <input type="hidden" name="username" value={info.email} autoComplete="username" />
          <div className="field">
            <label htmlFor="password">New password</label>
            <div className="pw">
              <input id="password" name="password" className="input" type={show ? "text" : "password"} autoComplete="new-password" aria-describedby="pw-hint" required />
              <button type="button" className="pw-toggle" aria-pressed={show} aria-controls="password" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
            </div>
            <p id="pw-hint" className="hint">At least 12 characters. A short sentence works well.</p>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="big" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
          <p className="muted">Next, you will set up two-step sign-in with an authenticator app on your phone.</p>
        </form>
      )}
    </Page>
  );
}
