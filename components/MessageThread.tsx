"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./ui";
import type { MessagesPayload, MessageRow } from "@/lib/messages";

type Props = {
  endpoint: string;
  senderKind: "CLIENT" | "STAFF";
  onRead?: () => void;
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function MessageThread({ endpoint, senderKind, onRead }: Props) {
  const [payload, setPayload] = useState<MessagesPayload | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didRead = useRef(false);

  const refresh = useCallback(async () => {
    const r = await api<MessagesPayload>(endpoint);
    if (r.ok) {
      setPayload(r.data);
      if (!didRead.current) {
        didRead.current = true;
        onRead?.();
      }
    }
  }, [endpoint, onRead]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const interval = setInterval(refresh, 30_000);
    const onFocus = () => void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [payload?.messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    const optimistic: MessageRow = {
      id: `opt-${Date.now()}`,
      senderKind,
      senderName: "You",
      body: trimmed,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setPayload((p) => p && { ...p, messages: [...p.messages, optimistic] });
    setText("");
    const r = await api<MessageRow>(endpoint, { method: "POST", json: { text: trimmed } });
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      setPayload((p) => p && { ...p, messages: p.messages.filter((m) => m.id !== optimistic.id) });
      setText(trimmed);
    } else {
      setPayload((p) => p && { ...p, messages: p.messages.map((m) => (m.id === optimistic.id ? r.data : m)) });
    }
  }

  if (!payload) return <p className="muted" role="status">Loading…</p>;

  return (
    <div className="msg-thread">
      {payload.closed && (
        <p className="note msg-closed">This case is closed. No new messages can be sent.</p>
      )}
      {payload.messages.length === 0 ? (
        <p className="muted msg-empty">No messages yet. Write something below to start the conversation.</p>
      ) : (
        <div className="msg-list" aria-live="polite" aria-label="Messages">
          {payload.messages.map((m) => {
            const mine = m.senderKind === senderKind;
            return (
              <div key={m.id} className={`msg-bubble ${mine ? "mine" : "theirs"}`}>
                <p className="msg-body">{m.body}</p>
                <p className="msg-meta">{mine ? "You" : m.senderName} · {relTime(m.createdAt)}</p>
              </div>
            );
          })}
          <div ref={bottomRef} aria-hidden="true" />
        </div>
      )}
      {!payload.closed && (
        <form className="msg-form" onSubmit={send}>
          <p className="muted" style={{ fontSize: ".88rem" }}>To send a document, use the Documents tab.</p>
          <label htmlFor="msg-input" className="sr-only">Message</label>
          <textarea
            id="msg-input"
            className="msg-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Write a message…"
            disabled={sending}
          />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="big" disabled={sending || !text.trim()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </div>
  );
}
