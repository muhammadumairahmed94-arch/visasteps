"use client";

import { useRef, useState } from "react";
import { uploadFiles } from "@/lib/upload-manager";
import { checkQuality, type QualityIssue } from "@/lib/quality";
import type { GuideShape } from "@/lib/files";
import CameraCapture from "./CameraCapture";

const MAX_FILE = 20 * 1024 * 1024;
const MAX_PAGES = 20;

type ScanPage = { id: string; file: File; thumb: string; issues: QualityIssue[] };

function issueLabel(i: QualityIssue): string {
  return i === "blurry" ? "Blurry" : i === "dark" ? "Too dark" : "Very small";
}

let seq = 0;

async function analyseFile(file: File): Promise<Omit<ScanPage, "id">> {
  const thumb = URL.createObjectURL(file);
  if (!file.type.startsWith("image/")) return { file, thumb, issues: [] };
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = thumb;
  });
  if (!img) return { file, thumb, issues: [] };
  const maxW = 400;
  const w = Math.min(img.naturalWidth, maxW);
  const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { file, thumb, issues: checkQuality(data, w, h) };
}

export default function ScanFlow({
  docId,
  guideShape,
  reviewDays,
  disabled,
  onSent,
}: {
  docId: string;
  guideShape: GuideShape;
  reviewDays: number;
  disabled?: boolean;
  onSent: (msg: string) => void;
}) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnBeforeSend, setWarnBeforeSend] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cameraAvailable =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

  async function addFiles(fileList: File[]) {
    if (!fileList.length) return;
    const tooBig = fileList.some((f) => f.size > MAX_FILE);
    if (tooBig) { setError("One of the files is too big. Please keep each file under 20 MB."); return; }
    if (pages.length + fileList.length > MAX_PAGES) {
      setError(`You can send up to ${MAX_PAGES} pages at a time.`);
      return;
    }
    setError(null);
    const analysed = await Promise.all(fileList.map(analyseFile));
    setPages((prev) => [...prev, ...analysed.map((a) => ({ ...a, id: `p${++seq}` }))]);
  }

  function remove(id: string) {
    setPages((p) => {
      const removed = p.find((x) => x.id === id);
      if (removed) URL.revokeObjectURL(removed.thumb);
      return p.filter((x) => x.id !== id);
    });
  }

  function move(id: string, delta: -1 | 1) {
    setPages((p) => {
      const i = p.findIndex((x) => x.id === id);
      if (i < 0) return p;
      const j = i + delta;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function send(force = false) {
    const hasWarnings = pages.some((p) => p.issues.length > 0);
    if (hasWarnings && !force) { setWarnBeforeSend(true); return; }
    setWarnBeforeSend(false);
    setSending(true);
    setPct(0);
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const msg = await uploadFiles(
        pages.map((p) => p.file),
        docId,
        pages.length > 1,
        (p) => setPct(p),
        ctrl.signal,
      );
      pages.forEach((p) => URL.revokeObjectURL(p.thumb));
      onSent(msg);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSending(false);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  if (sending) {
    return (
      <div className="scan-sending">
        <p role="status" aria-live="polite">{pct < 100 ? "Sending…" : "Almost done…"}</p>
        <div
          className="scan-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
        >
          <div className="scan-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <button
          type="button"
          className="link"
          onClick={() => { abortRef.current?.abort(); setSending(false); setPct(0); }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      {cameraOpen && (
        <CameraCapture
          guideShape={guideShape}
          onCapture={(f) => { setCameraOpen(false); void addFiles([f]); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {pages.length === 0 ? (
        <div className="scan-idle">
          {cameraAvailable && (
            <button type="button" className="big" disabled={disabled} onClick={() => setCameraOpen(true)}>
              Scan with camera
            </button>
          )}
          <label className={`ghost scan-file-label${disabled ? " scan-file-label--disabled" : ""}`} htmlFor="scan-file">
            Choose a file
            <input
              id="scan-file"
              type="file"
              accept="image/*,.pdf,.heic,.heif"
              multiple
              disabled={disabled}
              onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
            />
          </label>
        </div>
      ) : (
        <div className="scan-review">
          <div className="scan-thumbs" role="list" aria-label="Pages to send">
            {pages.map((p, i) => (
              <div key={p.id} className="scan-thumb" role="listitem">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={`Page ${i + 1}`} className="scan-thumb-img" />
                {p.issues.length > 0 && (
                  <div
                    className="scan-badge"
                    aria-label={`Warning: ${p.issues.map(issueLabel).join(", ")}`}
                  >
                    ⚠ {p.issues.map(issueLabel).join(", ")}
                  </div>
                )}
                <div className="scan-thumb-btns">
                  {i > 0 && (
                    <button type="button" className="scan-btn" onClick={() => move(p.id, -1)} aria-label={`Move page ${i + 1} up`}>↑</button>
                  )}
                  {i < pages.length - 1 && (
                    <button type="button" className="scan-btn" onClick={() => move(p.id, 1)} aria-label={`Move page ${i + 1} down`}>↓</button>
                  )}
                  <button type="button" className="scan-btn scan-btn-remove" onClick={() => remove(p.id)} aria-label={`Remove page ${i + 1}`}>✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="scan-add">
            {cameraAvailable && (
              <button type="button" className="ghost" onClick={() => setCameraOpen(true)}>+ Scan another page</button>
            )}
            <label className="ghost scan-file-label" htmlFor="scan-more">
              + Choose file
              <input
                id="scan-more"
                type="file"
                accept="image/*,.pdf,.heic,.heif"
                multiple
                onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              />
            </label>
          </div>

          {warnBeforeSend && (
            <div className="scan-warning" role="alert">
              <p>Some photos may be hard to read. You can fix them or send anyway.</p>
              <div className="btns">
                <button type="button" className="ghost" onClick={() => setWarnBeforeSend(false)}>Go back</button>
                <button type="button" className="big" onClick={() => send(true)}>Send anyway</button>
              </div>
            </div>
          )}

          {error && <p className="error" role="alert">{error}</p>}

          {!warnBeforeSend && (
            <button type="button" className="big" onClick={() => send()}>
              Send {pages.length === 1 ? "1 page" : `${pages.length} pages`}
            </button>
          )}
        </div>
      )}

      {pages.length === 0 && (
        <p className="muted">Not sure if it&apos;s right? Upload it anyway and our team will check it.</p>
      )}
      <p className="muted">
        After you send a document, your caseworker usually checks it within {reviewDays} working{" "}
        {reviewDays === 1 ? "day" : "days"}.
      </p>
    </>
  );
}
