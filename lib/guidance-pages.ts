import { db } from "./db";
import { encrypt, decrypt } from "./crypto";
import { extractHtmlText } from "./guidance";

const PURPOSE = "guidance-text";

/** Extract and store per-page or per-section text for a guidance source. */
export async function extractAndStorePages(sourceId: string, buffer: Buffer, mimeType: string): Promise<void> {
  let sections: Array<{ locator: string; text: string }> = [];

  if (mimeType === "application/pdf") {
    sections = await extractPdfSections(buffer);
    const totalChars = sections.reduce((n, s) => n + s.text.length, 0);
    if (totalChars < 100) {
      await db.guidanceSource.update({ where: { id: sourceId }, data: { extractionWarning: "no-text" } });
      return;
    }
  } else if (mimeType === "text/html") {
    sections = splitHtmlSections(buffer.toString("utf8"));
  }

  for (const s of sections) {
    await db.guidancePage.upsert({
      where: { sourceId_locator: { sourceId, locator: s.locator } },
      update: { encryptedText: encrypt(s.text, PURPOSE) },
      create: { sourceId, locator: s.locator, encryptedText: encrypt(s.text, PURPOSE) },
    });
  }
}

/** Load and decrypt all pages/sections for a source, ordered by locator. */
export async function loadDecryptedPages(sourceId: string): Promise<Array<{ locator: string; text: string }>> {
  const pages = await db.guidancePage.findMany({ where: { sourceId }, orderBy: { locator: "asc" } });
  return pages.map((p) => ({ locator: p.locator, text: decrypt(p.encryptedText, PURPOSE) }));
}

/** Split HTML by h1/h2/h3 headings. Returns one section per heading (plus a fallback if none). */
export function splitHtmlSections(html: string): Array<{ locator: string; text: string }> {
  // Split on heading open-tags, keeping the delimiter
  const parts = html.split(/(?=<h[123][\s>])/i);
  const sections: Array<{ locator: string; text: string }> = [];

  for (const part of parts) {
    const headingMatch = part.match(/^<h[123][^>]*>([\s\S]*?)<\/h[123]>/i);
    if (headingMatch) {
      const heading = extractHtmlText(headingMatch[1]).trim().slice(0, 200);
      const body = part.slice(headingMatch[0].length);
      const text = (heading + " " + extractHtmlText(body)).replace(/\s+/g, " ").trim();
      if (text.length > 0 && heading.length > 0) {
        sections.push({ locator: heading, text });
      }
    } else {
      // Content before any heading
      const text = extractHtmlText(part).replace(/\s+/g, " ").trim();
      if (text.length > 20) {
        sections.push({ locator: "Main content", text });
      }
    }
  }

  if (sections.length === 0) {
    const text = extractHtmlText(html).replace(/\s+/g, " ").trim();
    if (text.length > 0) sections.push({ locator: "Main content", text });
  }

  return sections;
}

async function extractPdfSections(buffer: Buffer): Promise<Array<{ locator: string; text: string }>> {
  const { resolve } = await import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfjsLib: any;
  try {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjsLib = await import("pdfjs-dist");
  }
  // Point to the worker file so pdfjs-dist can spawn it in Node.js
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${resolve(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")}`;

  const sections: Array<{ locator: string; text: string }> = [];
  const doc = await (pdfjsLib.getDocument({ data: new Uint8Array(buffer) }) as { promise: Promise<unknown> }).promise;
  const numPages = (doc as { numPages: number }).numPages;

  for (let i = 1; i <= numPages; i++) {
    const page = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(i);
    const content = await (page as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent();
    const text = content.items
      .map((item) => {
        const it = item as { str?: string; hasEOL?: boolean };
        return (it.str ?? "") + (it.hasEOL ? "\n" : "");
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) {
      sections.push({ locator: `p${i}`, text });
    }
  }

  return sections;
}
