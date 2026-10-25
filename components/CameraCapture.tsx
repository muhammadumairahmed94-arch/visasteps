"use client";

import { useEffect, useRef, useState } from "react";
import type { GuideShape } from "@/lib/files";

const GUIDE_DIMS: Record<GuideShape, { width: string; aspectRatio: string }> = {
  "id-card": { width: "88%", aspectRatio: "125/88" },   // passport photo page, landscape
  a4:        { width: "75%", aspectRatio: "210/297" },  // A4 portrait
};

export default function CameraCapture({
  guideShape,
  onCapture,
  onClose,
}: {
  guideShape: GuideShape;
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        if (!active) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          v.onloadedmetadata = () => { void v.play(); setReady(true); };
        }
      })
      .catch(() => { if (active) setErr("Camera not available. Please use the file chooser instead."); });
    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(
      (blob) => blob && onCapture(new File([blob], "scan.jpg", { type: "image/jpeg" })),
      "image/jpeg",
      0.92,
    );
  }

  const { width, aspectRatio } = GUIDE_DIMS[guideShape];

  return (
    <div className="cam-modal" role="dialog" aria-modal aria-label="Camera — line up the document in the frame">
      <video ref={videoRef} autoPlay playsInline muted className="cam-video" />
      <div className="cam-overlay" aria-hidden>
        <div className="cam-guide" style={{ width, aspectRatio }}>
          <span className="cam-corner cam-tl" />
          <span className="cam-corner cam-tr" />
          <span className="cam-corner cam-bl" />
          <span className="cam-corner cam-br" />
        </div>
      </div>
      {err && (
        <div className="cam-err" role="alert">
          <p>{err}</p>
          <button type="button" className="ghost" onClick={onClose}>Close</button>
        </div>
      )}
      <div className="cam-actions">
        <button type="button" className="ghost cam-cancel" onClick={onClose}>Cancel</button>
        {!err && (
          <button type="button" className="big" disabled={!ready} onClick={capture}>
            {ready ? "Capture" : "Starting camera…"}
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="sr-only" />
    </div>
  );
}
