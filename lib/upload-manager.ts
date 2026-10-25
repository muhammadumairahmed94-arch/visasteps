// Browser-only: do not import from server components or API routes.

// Must match SERVER_CHUNK_SIZE in lib/upload-sessions.ts
const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function putChunk(url: string, body: ArrayBuffer, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    const res = await fetch(url, {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/octet-stream" },
      signal,
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) {
      const { error } = (await res.json().catch(() => ({ error: "Upload failed." }))) as { error?: string };
      throw new Error(error ?? "Upload failed.");
    }
    // 5xx → retry
  }
  throw new Error("Upload failed after several attempts. Please check your connection and try again.");
}

export async function uploadFiles(
  pages: File[],
  docId: string,
  multiPage: boolean,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const bufs = await Promise.all(pages.map((f) => f.arrayBuffer()));
  const pageMetas = await Promise.all(
    bufs.map(async (buf, i) => ({
      fileName: pages[i].name || "scan.jpg",
      sizeBytes: pages[i].size,
      sha256: await sha256Hex(buf),
      totalChunks: Math.max(1, Math.ceil(pages[i].size / CHUNK_SIZE)),
    })),
  );

  const startRes = await fetch("/api/client/upload/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, pages: pageMetas, multiPage }),
    signal,
  });
  if (!startRes.ok) {
    const { error } = (await startRes.json().catch(() => ({ error: "Could not start upload." }))) as { error?: string };
    throw new Error(error ?? "Could not start upload.");
  }
  const { sessionId } = (await startRes.json()) as { sessionId: string };

  const totalChunks = pageMetas.reduce((s, p) => s + p.totalChunks, 0);
  let done = 0;

  for (let pi = 0; pi < pages.length; pi++) {
    const buf = bufs[pi];
    const meta = pageMetas[pi];
    for (let ci = 0; ci < meta.totalChunks; ci++) {
      await putChunk(
        `/api/client/upload/${sessionId}/chunk?page=${pi}&n=${ci}`,
        buf.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE),
        signal,
      );
      done++;
      onProgress(Math.round((done / totalChunks) * 90)); // 90% for chunks, 10% for complete
    }
  }

  const completeRes = await fetch(`/api/client/upload/${sessionId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });
  if (!completeRes.ok) {
    const { error } = (await completeRes.json().catch(() => ({ error: "Upload failed at final step." }))) as { error?: string };
    throw new Error(error ?? "Upload failed at final step.");
  }
  onProgress(100);
  const { message } = (await completeRes.json()) as { message: string };
  return message;
}
