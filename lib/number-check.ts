const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Matches "page 2", "pages 2-3", "p. 2", "pp. 2-3" */
const PAGE_REF_RE = /\bpp?\.\s*\d+(?:\s*[-–]\s*\d+)?\b|\bpages?\s+\d+(?:\s*[-–]\s*\d+)?\b/gi;

/** Matches DD/MM/YYYY or DD.MM.YYYY (UK day-first) */
const NUMERIC_DATE_RE = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/g;

/** Matches "12 March 2027" or "12 Mar 2027" */
const NAMED_DATE_SRC = `\\b(\\d{1,2})\\s+(${[...MONTHS_FULL, ...MONTHS_SHORT].join("|")})\\s+(\\d{4})\\b`;

interface ParsedDate {
  day: number;
  month: number; // 1-12
  year: number;
  original: string;
}

function parseUkDates(text: string): ParsedDate[] {
  const results: ParsedDate[] = [];

  let m: RegExpExecArray | null;

  const numRe = new RegExp(NUMERIC_DATE_RE.source, "g");
  while ((m = numRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      results.push({ day, month, year, original: m[0] });
    }
  }

  const namedRe = new RegExp(NAMED_DATE_SRC, "gi");
  while ((m = namedRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthStr = m[2].toLowerCase();
    let month = MONTHS_FULL.findIndex((mo) => mo.toLowerCase() === monthStr) + 1;
    if (month === 0) month = MONTHS_SHORT.findIndex((mo) => mo.toLowerCase() === monthStr) + 1;
    const year = parseInt(m[3], 10);
    if (month > 0) {
      results.push({ day, month, year, original: m[0] });
    }
  }

  return results;
}

function dateVariants(day: number, month: number, year: number): string[] {
  const d = String(day);
  const mo = String(month);
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  return [
    `${dd}/${mm}/${year}`,
    `${d}/${mo}/${year}`,
    `${dd}.${mm}.${year}`,
    `${d}.${mo}.${year}`,
    `${d} ${MONTHS_FULL[month - 1]} ${year}`,
    `${d} ${MONTHS_SHORT[month - 1]} ${year}`,
  ];
}

function extractPlainNumbers(text: string): string[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((n) => n.replace(/,/g, "")).filter((n) => n.length > 0);
}

/**
 * Checks that every number and date in claimText appears in quote.
 *
 * Rules:
 * - Page references ("page N", "p. N", "pp. N-M", "pages N-M") are stripped and ignored.
 * - UK dates (DD/MM/YYYY, DD.MM.YYYY, D Month YYYY, D Mon YYYY) are matched cross-format:
 *   12/03/2027 equals 12 March 2027 because both are 12th March (UK day-first).
 *   03/12/2027 does NOT equal 12 March 2027 — that is 3rd December.
 * - Remaining numbers (e.g. £29,000) must appear verbatim in quote (commas ignored).
 * - Returns true when no numbers or dates remain to check.
 */
export function numbersMatch(claimText: string, quote: string): boolean {
  const stripped = claimText.replace(PAGE_REF_RE, "");

  const dates = parseUkDates(stripped);

  const lowerQuote = quote.toLowerCase();
  for (const { day, month, year } of dates) {
    const variants = dateVariants(day, month, year);
    if (!variants.some((v) => lowerQuote.includes(v.toLowerCase()))) {
      return false;
    }
  }

  // Remove matched date spans before checking bare numbers to avoid double-counting.
  let withoutDates = stripped;
  for (const { original } of dates) {
    withoutDates = withoutDates.replace(original, " ");
  }

  const numbers = extractPlainNumbers(withoutDates);
  if (numbers.length === 0) return true;

  const strippedQuote = quote.replace(/,/g, "");
  return numbers.every((n) => {
    const escaped = n.replace(/\./g, "\\.");
    const re = new RegExp(`(?<!\\d)${escaped}(?!\\d)`);
    return re.test(strippedQuote);
  });
}
