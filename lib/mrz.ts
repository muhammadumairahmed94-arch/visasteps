/**
 * ICAO 9303 TD3 Machine Readable Zone (MRZ) check-digit validation.
 *
 * TD3 passport Line 2 (44 chars, 1-indexed):
 *   1–9   Passport number
 *   10    Check digit for passport number
 *   11–13 Nationality
 *   14–19 Date of birth (YYMMDD)
 *   20    Check digit for DOB
 *   21    Sex
 *   22–27 Expiry date (YYMMDD)
 *   28    Check digit for expiry
 *   29–42 Optional personal number
 *   43    Check digit for optional
 *   44    Composite check digit (positions 1–10 + 14–20 + 22–43)
 *
 * Line 1 (44 chars): P<{NATION}{SURNAME}<<{GIVEN NAMES}
 * (No check digits on line 1.)
 */

/** Map an MRZ character to its numeric value. */
export function mrzCharValue(c: string): number {
  if (c === "<") return 0;
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // 0–9
  if (code >= 65 && code <= 90) return code - 55;  // A–Z → 10–35
  return 0; // treat unknown as 0
}

/** Compute the ICAO check digit for a field string. */
export function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += mrzCharValue(field[i]) * weights[i % 3];
  }
  return sum % 10;
}

export interface MrzFieldCheck {
  field: string;        // human-readable field name
  expected: number;     // check digit in the MRZ
  computed: number;     // what we computed
  valid: boolean;
}

export interface MrzValidationResult {
  valid: boolean;           // true only when ALL check digits pass
  checks: MrzFieldCheck[];  // one entry per validated field
}

/**
 * Validate all check digits in a TD3 passport Line 2 (44 characters).
 * Returns a result with one check per field.
 * An unrecognised line (wrong length or no digits) returns valid=false with an empty checks array.
 */
export function validateMrzLine2(line2: string): MrzValidationResult {
  const s = line2.trim();
  if (s.length !== 44) {
    return { valid: false, checks: [] };
  }

  // Helper: 1-indexed slice
  const chars = (from: number, to: number) => s.slice(from - 1, to);
  const digit = (pos: number) => parseInt(s[pos - 1], 10);

  const checks: MrzFieldCheck[] = [
    {
      field: "Passport number",
      expected: digit(10),
      computed: mrzCheckDigit(chars(1, 9)),
      valid: false,
    },
    {
      field: "Date of birth",
      expected: digit(20),
      computed: mrzCheckDigit(chars(14, 19)),
      valid: false,
    },
    {
      field: "Expiry date",
      expected: digit(28),
      computed: mrzCheckDigit(chars(22, 27)),
      valid: false,
    },
    {
      field: "Optional data",
      expected: digit(43),
      computed: mrzCheckDigit(chars(29, 42)),
      valid: false,
    },
    {
      field: "Composite",
      expected: digit(44),
      computed: mrzCheckDigit(chars(1, 10) + chars(14, 20) + chars(22, 43)),
      valid: false,
    },
  ];

  for (const c of checks) {
    c.valid = c.expected === c.computed;
  }

  return {
    valid: checks.every((c) => c.valid),
    checks,
  };
}

/**
 * Extract the two MRZ lines from a block of text.
 * Looks for consecutive lines of exactly 44 characters each containing only A-Z, 0-9, and <.
 * Returns null if not found.
 */
export function extractMrzLines(text: string): [string, string] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const mrzLine = /^[A-Z0-9<]{44}$/;
  for (let i = 0; i < lines.length - 1; i++) {
    if (mrzLine.test(lines[i]) && mrzLine.test(lines[i + 1])) {
      return [lines[i], lines[i + 1]];
    }
  }
  return null;
}
