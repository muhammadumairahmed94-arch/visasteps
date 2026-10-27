/**
 * Shared helpers for the ai:eval harness and the "Save as test case" admin action.
 *
 * buildTextPdf  — create a single-page text PDF using the same font setup as real
 *                 uploads (LiberationSans + fontkit ToUnicode CMap, so pdfjs extracts
 *                 text faithfully in every environment).
 * piiScrub      — replace holder names, dates of birth, passport numbers and
 *                 addresses with synthetic values before storing a fixture.
 * writeEvalFixture / readEvalFixtures — JSON files under evals/.
 */

import { readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { GuidanceCheckVerdict } from "./guidance-check";

// ─── PDF creation ─────────────────────────────────────────────────────────────

const FONT_PATH = resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");

/** Max chars per line before wrapping (at font-size 12, A4 margins of 60pt ≈ 72 chars). */
const WRAP_WIDTH = 72;

function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if ((current + " " + word).length <= width) {
        current += " " + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.join("\n");
}

/**
 * Build a single-page text PDF using LiberationSans with a ToUnicode CMap.
 * pdfjs-dist can reliably extract text from this PDF without needing standardFontDataUrl.
 */
export async function buildTextPdf(text: string): Promise<Buffer> {
  const fontBytes = readFileSync(FONT_PATH);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.addPage([595, 842]); // A4
  const wrapped = wrapText(text, WRAP_WIDTH);
  page.drawText(wrapped, { x: 60, y: 760, size: 12, font, lineHeight: 16 });
  return Buffer.from(await doc.save());
}

// ─── PII scrubbing ────────────────────────────────────────────────────────────

const FAKE_NAME_POOL = [
  "Alex Sample", "Jordan Sample", "Casey Sample", "Taylor Sample",
  "Riley Sample", "Morgan Sample", "Avery Sample", "Quinn Sample",
];

/**
 * Replace PII in a document text with synthetic stand-ins.
 * knownPii: facts already extracted by the AI (factKind + value).
 */
export function piiScrub(
  text: string,
  knownPii: Array<{ factKind: string; value: string }>,
): string {
  let out = text;
  const nameMap = new Map<string, string>();
  let nameIdx = 0;

  for (const { factKind, value } of knownPii) {
    if (!value) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    switch (factKind) {
      case "holder-name": {
        if (!nameMap.has(value)) {
          nameMap.set(value, FAKE_NAME_POOL[nameIdx % FAKE_NAME_POOL.length] ?? "Alex Sample");
          nameIdx++;
        }
        out = out.replace(new RegExp(escaped, "g"), nameMap.get(value)!);
        break;
      }
      case "date-of-birth":
        out = out.replace(new RegExp(escaped, "g"), "01/01/1990");
        break;
      case "passport-number":
        out = out.replace(new RegExp(escaped, "gi"), "XX000000");
        break;
      case "address":
        out = out.replace(new RegExp(escaped, "g"), "[ADDRESS REDACTED]");
        break;
    }
  }

  // Regex fallbacks for PII not captured as facts
  out = out.replace(/\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/g, "XX1 1XX"); // UK postcodes
  out = out.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "test@example.com");
  out = out.replace(/\b(?:\+44\s?|0)(?:\d\s?){9,10}\b/g, "01234 567890"); // UK phone numbers

  return out;
}

// ─── Fixture types ────────────────────────────────────────────────────────────

export interface EvalFixtureLinkedItem {
  checklistItemId: string;
  title: string;
  hasCurrentFile: boolean;
  isRedo: boolean;
}

export interface EvalFixturePage {
  /** Synthetic doc ID — also used as the checklistItemId for linked-item mapping. */
  docId: string;
  title: string;
  uploaderKind: "CLIENT" | "SPONSOR";
  pageNumber: number;
  text: string;
}

export interface EvalFixture {
  id: string;
  createdAt: string;
  route: string;
  requirement: {
    id: string;
    whatIsChecked: string;
    ruleType: string;
    limitOrThreshold: string | null;
    evidenceNeeded: string;
    citationQuote: string;
  };
  linkedItemStatuses: EvalFixtureLinkedItem[];
  pages: EvalFixturePage[];
  expectedVerdict: GuidanceCheckVerdict;
  caseworkerNote: string | null;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const DEFAULT_EVALS_DIR = resolve(process.cwd(), "evals");

export function evalsDir(): string {
  return DEFAULT_EVALS_DIR;
}

export function writeEvalFixture(fixture: EvalFixture, dir: string = DEFAULT_EVALS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const slug = fixture.requirement.ruleType.toLowerCase().replace(/_/g, "-");
  const ts = fixture.createdAt.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const filename = `${ts}-${slug}-${fixture.expectedVerdict.toLowerCase()}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(fixture, null, 2), "utf8");
  return filepath;
}

export function readEvalFixtures(dir: string = DEFAULT_EVALS_DIR): EvalFixture[] {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const fixtures: EvalFixture[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf8");
      fixtures.push(JSON.parse(raw) as EvalFixture);
    } catch {
      // skip malformed fixtures
    }
  }
  return fixtures;
}
