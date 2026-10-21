import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { detectKind, toPdf } from "../lib/files";

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

describe("detectKind", () => {
  it("reads the real type from content, not the name", async () => {
    expect(await detectKind(PNG)).toBe("png");
    expect(await detectKind(Buffer.from("%PDF-1.7\n%âãÏÓ\n"))).toBe("pdf");
  });
  it("rejects a text file pretending to be a PDF", async () => {
    expect(await detectKind(Buffer.from("not really a pdf"))).toBeNull();
  });
});

describe("toPdf", () => {
  it("wraps an image in a one-page PDF", async () => {
    const out = await toPdf(PNG, "png");
    expect(out.ext).toBe("pdf");
    expect((await PDFDocument.load(out.data)).getPageCount()).toBe(1);
  });
});

describe("iPhone HEIC photos", () => {
  it("are recognised by content and converted to a one-page PDF", async () => {
    const heic = readFileSync(new URL("./fixtures/sample.heic", import.meta.url));
    expect(await detectKind(heic)).toBe("heic");
    const out = await toPdf(heic, "heic");
    expect(out.ext).toBe("pdf");
    expect(out.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(out.data)).getPageCount()).toBe(1);
  });
});
