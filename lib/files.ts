import { fileTypeFromBuffer } from "file-type";
import { PDFDocument } from "pdf-lib";

export type GuideShape = "id-card" | "a4";

/** Returns the camera guide shape for a checklist item. */
export function guideShape(typeKey: string): GuideShape {
  const lower = typeKey.toLowerCase();
  return lower.includes("passport") || lower.includes("visa") ? "id-card" : "a4";
}

export const MAX_BYTES = 20 * 1024 * 1024;

export type Kind = "pdf" | "jpg" | "png" | "heic";

/** Decide the real type from the file's first bytes, never from its name. */
export async function detectKind(data: Buffer): Promise<Kind | null> {
  const t = await fileTypeFromBuffer(data);
  switch (t?.mime) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return null;
  }
}

/** Merges an array of single-page PDFs (already processed by toPdf) into one multi-page PDF. */
export async function mergePdf(pageBuffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of pageBuffers) {
    const src = await PDFDocument.load(new Uint8Array(buf));
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const page of copied) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

/** Wraps a photo (JPG, PNG or iPhone HEIC) in a single-page PDF sized to the image. PDFs pass through. */
export async function toPdf(data: Buffer, kind: Kind): Promise<{ data: Buffer; ext: string }> {
  if (kind === "pdf") return { data, ext: "pdf" };
  if (kind === "heic") {
    // HEIC → JPEG first (pure JavaScript decoder, no system libraries needed)
    const { default: convert } = await import("heic-convert");
    data = Buffer.from(await convert({ buffer: data, format: "JPEG", quality: 0.9 }));
    kind = "jpg";
  }
  const pdf = await PDFDocument.create();
  // A fresh copy: small Buffers share a memory pool at an offset, which pdf-lib does not handle
  const bytes = new Uint8Array(data);
  const img = kind === "jpg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  const page = pdf.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return { data: Buffer.from(await pdf.save()), ext: "pdf" };
}
