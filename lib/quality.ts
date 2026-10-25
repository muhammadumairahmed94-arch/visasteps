// Pure image-quality helpers — no Node.js imports, safe to use in both browser and server.

export const BLUR_THRESHOLD = 80;
export const DARK_THRESHOLD = 40;
export const TINY_DIM = 300;

export type QualityIssue = "blurry" | "dark" | "tiny";

/**
 * Laplacian variance of the greyscale channel. Higher = sharper.
 * Expects RGBA ImageData pixels (4 bytes per pixel, row-major).
 */
export function lapVar(data: Uint8ClampedArray, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  const n = (w - 2) * (h - 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const g = (ry: number, rx: number) => {
        const i = (ry * w + rx) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      };
      // Laplacian kernel: top + bottom + left + right − 4 × centre
      const lap = g(y - 1, x) + g(y + 1, x) + g(y, x - 1) + g(y, x + 1) - 4 * g(y, x);
      sum += lap;
      sumSq += lap * lap;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Mean brightness (0–255) across the greyscale channel. Expects RGBA pixel data. */
export function meanBrightness(data: Uint8ClampedArray): number {
  const pixels = data.length / 4;
  if (pixels === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / pixels;
}

/** Returns any quality issues detected. Never throws. */
export function checkQuality(data: Uint8ClampedArray, w: number, h: number): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (w < TINY_DIM || h < TINY_DIM) issues.push("tiny");
  if (meanBrightness(data) < DARK_THRESHOLD) issues.push("dark");
  if (lapVar(data, w, h) < BLUR_THRESHOLD) issues.push("blurry");
  return issues;
}
