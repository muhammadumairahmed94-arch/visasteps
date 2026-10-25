import { describe, expect, it } from "vitest";
import { lapVar, meanBrightness, checkQuality, BLUR_THRESHOLD, DARK_THRESHOLD, TINY_DIM } from "../lib/quality";

function pixels(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

function checkerboard(w: number, h: number, lo: number, hi: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (x + y) % 2 === 0 ? lo : hi;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return data;
}

describe("lapVar", () => {
  it("returns 0 for a uniform image (no edges)", () => {
    const data = pixels(10, 10, 100, 100, 100);
    expect(lapVar(data, 10, 10)).toBe(0);
  });

  it("returns a high value for a sharp checkerboard", () => {
    const data = checkerboard(20, 20, 0, 255);
    expect(lapVar(data, 20, 20)).toBeGreaterThan(BLUR_THRESHOLD);
  });

  it("handles images smaller than 3×3 gracefully", () => {
    const data = pixels(2, 2, 128, 128, 128);
    expect(lapVar(data, 2, 2)).toBe(0);
  });
});

describe("meanBrightness", () => {
  it("returns 0 for black pixels", () => {
    expect(meanBrightness(pixels(4, 4, 0, 0, 0))).toBe(0);
  });

  it("returns 255 for white pixels", () => {
    expect(meanBrightness(pixels(4, 4, 255, 255, 255))).toBe(255);
  });

  it("weights green channel highest (NTSC: R=0.299 G=0.587 B=0.114)", () => {
    const green = meanBrightness(pixels(1, 1, 0, 255, 0));
    const blue = meanBrightness(pixels(1, 1, 0, 0, 255));
    expect(green).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.587 * 255, 0);
  });

  it("returns 0 for an empty array", () => {
    expect(meanBrightness(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe("checkQuality", () => {
  it(`flags tiny images (< ${TINY_DIM} px in either dimension)`, () => {
    const data = pixels(100, 100, 200, 200, 200);
    expect(checkQuality(data, 100, 100)).toContain("tiny");
  });

  it(`flags dark images (mean brightness < ${DARK_THRESHOLD})`, () => {
    const data = pixels(400, 400, 5, 5, 5);
    expect(checkQuality(data, 400, 400)).toContain("dark");
  });

  it(`flags blurry images (uniform colour = zero Laplacian variance < ${BLUR_THRESHOLD})`, () => {
    const data = pixels(400, 400, 128, 128, 128);
    expect(checkQuality(data, 400, 400)).toContain("blurry");
  });

  it("returns no issues for a bright sharp image", () => {
    const data = checkerboard(400, 400, 200, 255);
    expect(checkQuality(data, 400, 400)).toHaveLength(0);
  });

  it("can return multiple issues at once", () => {
    const data = pixels(50, 50, 2, 2, 2); // tiny AND dark AND blurry
    const issues = checkQuality(data, 50, 50);
    expect(issues).toContain("tiny");
    expect(issues).toContain("dark");
    expect(issues).toContain("blurry");
  });
});
