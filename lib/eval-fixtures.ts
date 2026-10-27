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

// ─── label-aware DOB scrubbing ────────────────────────────────────────────────

// Matches "date of birth", "dob", "d.o.b.", "born", "birth date" (case-insensitive)
const DOB_LABEL = String.raw`(?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|born(?:\s+on)?|birth\s+date)`;
// Separator between label and date value: colon, spaces, comma (up to 10 chars)
const DOB_SEP = String.raw`[:\s,]{0,12}`;
// All supported date formats as one alternation
const DATE_BLOCK = [
  String.raw`(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`,          // YYYY-MM-DD
  String.raw`(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}`, // DD/MM/YYYY etc.
  String.raw`(?:0?[1-9]|[12]\d|3[01])\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}`, // DD Month YYYY
  String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:0?[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}`, // Month DD, YYYY
].join("|");

/**
 * Replace date values that are clearly labelled as a date of birth.
 * Dates without a DOB label (expiry dates, pay dates, etc.) are left intact
 * because they are typically what the test case is testing.
 */
function scrubLabelledDobs(text: string): string {
  // Label before value: "Date of birth: 14/05/1988"
  let out = text.replace(
    new RegExp(`(${DOB_LABEL}${DOB_SEP})(${DATE_BLOCK})`, "gi"),
    (_, label) => label + "01/01/1990",
  );
  // Value before label: "14/05/1988 (date of birth)"
  out = out.replace(
    new RegExp(`(${DATE_BLOCK})(${DOB_SEP}${DOB_LABEL})`, "gi"),
    (_, _date, labelPart) => "01/01/1990" + labelPart,
  );
  return out;
}

const FAKE_NAME_POOL = [
  "Alex Sample", "Jordan Sample", "Casey Sample", "Taylor Sample",
  "Riley Sample", "Morgan Sample", "Avery Sample", "Quinn Sample",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace PII in a document text with synthetic stand-ins.
 * knownPii: facts already extracted by the AI (factKind + value).
 *
 * First pass only — the admin must review and edit further before saving.
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

    switch (factKind) {
      case "holder-name": {
        if (!nameMap.has(value)) {
          nameMap.set(value, FAKE_NAME_POOL[nameIdx % FAKE_NAME_POOL.length] ?? "Alex Sample");
          nameIdx++;
        }
        const fake = nameMap.get(value)!;
        const [fakeSurname = "SAMPLE", fakeGiven = "SAMPLE"] = fake.split(" ");

        // 1. Full name as-is
        out = out.replace(new RegExp(escapeRe(value), "gi"), fake);

        // 2. Individual name tokens (words ≥3 chars) replaced independently
        for (const token of value.split(/\s+/)) {
          if (token.length < 3) continue;
          out = out.replace(new RegExp(`\\b${escapeRe(token)}\\b`, "gi"), fake.split(" ")[0] ?? "Sample");
        }

        // 3. MRZ surname<<givenname variants  e.g. SMITH<<JOHN< or SMITH<<JOHN<PAUL<
        const mrzSurname = value.split(/\s+/)[value.split(/\s+/).length - 1]?.toUpperCase() ?? "SAMPLE";
        const mrzGiven  = value.split(/\s+/).slice(0, -1).join("<").toUpperCase() || "SAMPLE";
        out = out.replace(
          new RegExp(`${escapeRe(mrzSurname)}<<${escapeRe(mrzGiven)}[<A-Z]*`, "g"),
          `${fakeSurname.toUpperCase()}<<${fakeGiven.toUpperCase()}<`,
        );
        // Also match reversed order (given<<surname)
        out = out.replace(
          new RegExp(`${escapeRe(mrzGiven)}<<${escapeRe(mrzSurname)}[<A-Z]*`, "g"),
          `${fakeGiven.toUpperCase()}<<${fakeSurname.toUpperCase()}<`,
        );
        break;
      }

      case "date-of-birth":
        out = out.replace(new RegExp(escapeRe(value), "gi"), "01/01/1990");
        break;

      case "passport-number":
        out = out.replace(new RegExp(escapeRe(value), "gi"), "XX000000");
        break;

      case "address":
        out = out.replace(new RegExp(escapeRe(value), "gi"), "[ADDRESS REDACTED]");
        break;
    }
  }

  // ── Regex fallbacks ───────────────────────────────────────────────────────
  // Order matters: NI before sort codes (NI digits would otherwise trigger
  // the sort-code pattern when the replacement leaves spaced digits).

  // UK postcodes  e.g. SW1A 2AA, EC2V 8RT
  out = out.replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/gi, "XX1 1XX");

  // Email addresses
  out = out.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "test@example.com");

  // UK phone numbers (mobile or landline, optionally +44)
  // No leading \b — \b doesn't fire before '+' (non-word char)
  out = out.replace(/(?<!\d)(?:\+44\s?|0)(?:\d[\s-]?){9,10}(?!\d)/g, "01234 567890");

  // National Insurance numbers  e.g. NE 12 34 56 A or NE123456A
  // Must run BEFORE sort-code replacement; replacement deliberately avoids
  // digit groups that the sort-code pattern would re-match.
  out = out.replace(/\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, "AB000000X");

  // UK sort codes  XX-XX-XX or XX XX XX
  out = out.replace(/\b\d{2}[-\s]\d{2}[-\s]\d{2}\b/g, "01-02-03");

  // UK account numbers: 8 consecutive digits (context-guarded by "account" keyword)
  out = out.replace(
    /\b(account[\s:]+(?:number[\s:]+)?|acct\.?\s*:?\s*)(\d{8})\b/gi,
    "$112345678",
  );

  // IBANs  e.g. GB29 NWBK 6016 1331 9268 19
  out = out.replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g, (match) => {
    // Only replace if it looks like a plausible IBAN (≥15 chars when spaces removed)
    if (match.replace(/\s/g, "").length >= 15) return "GB00 BANK 0000 0000 0000 00";
    return match;
  });

  // Dates of birth — only when clearly labelled as a DOB.
  // Unlabelled dates (expiry dates, payslip dates, etc.) are preserved because
  // they are usually what the test case is actually testing.
  out = scrubLabelledDobs(out);

  // MRZ lines: 44-char lines of uppercase letters, digits and <
  // First char may be a letter (line 1, e.g. 'P') or digit (line 2 of passport MRZ).
  out = out.replace(/[A-Z0-9][A-Z0-9<]{43}/g, (match) => {
    // Only redact if it contains '<', which is the definitive MRZ filler character
    if (match.includes("<")) return "[MRZ LINE REDACTED]";
    return match;
  });

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
  /** ISO date string used as the "today" anchor when evaluating this fixture. */
  anchorDate: string;
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
