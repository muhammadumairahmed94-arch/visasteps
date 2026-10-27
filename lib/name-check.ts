/**
 * Name comparison with normalisation and known spelling-variant handling.
 *
 * Normalisation applied before comparison:
 * - Lowercase
 * - Remove accents (NFD → strip combining marks)
 * - Replace hyphens and apostrophes with spaces
 * - Remove commas and full stops
 * - "SURNAME, GIVEN NAMES" reordered to "GIVEN NAMES SURNAME"
 * - MRZ "SURNAME<<GIVEN" reordered to "GIVEN SURNAME" (single < → space)
 *
 * Verdict rules:
 * - FAIL only when no expected name part matches at all.
 * - Any partial match (some parts match, some don't) → UNCLEAR "Name differs: please confirm".
 * - A variant spelling (Mohammed vs Muhammad) → UNCLEAR.
 * - Extra middle names in the document → UNCLEAR (when both first and last are expected).
 * - All expected parts matched exactly with no extras → OK.
 */

export type NameVerdict = "OK" | "UNCLEAR" | "FAIL";

export interface NameComparison {
  verdict: NameVerdict;
  detail: string;
}

// Groups of interchangeable first-name spellings.
// Members within a group are treated as UNCLEAR (not FAIL) when they differ.
export const NAME_VARIANT_GROUPS: readonly string[][] = [
  ["Muhammad", "Mohammed", "Mohammad", "Muhammed", "Mohamed", "Muhamed"],
  ["Katherine", "Catherine", "Kathryn", "Katharine", "Katherin"],
  ["Elizabeth", "Elisabeth", "Eliza", "Liz", "Lisa", "Beth"],
  ["Fatima", "Fatimah", "Fatemeh", "Fatema"],
  ["Aisha", "Aysha", "Ayesha", "Aiesha"],
  ["Zainab", "Zaynab", "Zeynep"],
  ["Sara", "Sarah"],
  ["Ann", "Anne", "Anna"],
  ["John", "Jon"],
  ["Mariam", "Maryam", "Miriam", "Mary"],
  ["Amina", "Ameena", "Aminah"],
  ["Ali", "Aly"],
  ["Hassan", "Hasan"],
  ["Hussein", "Hussain", "Husain", "Hossein"],
];

/**
 * Normalise a name string for comparison.
 * Handles MRZ order, "SURNAME, GIVEN" order, accents, hyphens, apostrophes.
 */
export function normaliseName(s: string): string {
  // MRZ format: SURNAME<<GIVEN (double angle-brackets separate surname from given names)
  if (s.includes("<<")) {
    const firstDbl = s.indexOf("<<");
    const surname = s.slice(0, firstDbl).replace(/</g, " ").trim();
    const given = s.slice(firstDbl + 2).replace(/</g, " ").trim();
    s = [given, surname].filter(Boolean).join(" ");
  } else if (s.includes(",")) {
    // "SURNAME, GIVEN NAMES" → reorder to "GIVEN NAMES SURNAME"
    const commaIdx = s.indexOf(",");
    const surname = s.slice(0, commaIdx).trim();
    const given = s.slice(commaIdx + 1).trim();
    s = [given, surname].filter(Boolean).join(" ");
  }
  // Remove accents
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Replace hyphens and apostrophes with spaces
  s = s.replace(/[-']/g, " ");
  // Remove commas and full stops
  s = s.replace(/[,.]/g, "");
  // Lowercase and collapse whitespace
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split a full name into individual word parts, ignoring empty strings. */
export function splitNameParts(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** True when two (already-lowercased) name tokens are known spelling variants of each other. */
export function areVariants(a: string, b: string): boolean {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al === bl) return false; // exact match handled separately
  return NAME_VARIANT_GROUPS.some(
    (group) => group.map((g) => g.toLowerCase()).includes(al) && group.map((g) => g.toLowerCase()).includes(bl),
  );
}

/**
 * Compare an extracted document name against the expected name parts.
 *
 * Both sides are normalised before comparison.
 * FAIL only when no expected part matches at all.
 * Partial match → UNCLEAR.
 */
export function compareNames(
  docName: string,
  expectedFirst: string | null,
  expectedLast: string | null,
): NameComparison {
  if (!expectedFirst && !expectedLast) {
    return { verdict: "UNCLEAR", detail: "Expected name not set; cannot verify." };
  }

  const expected = [expectedFirst, expectedLast].filter(Boolean) as string[];
  // Normalise and flatten each expected component into individual tokens
  const normExpected = expected.flatMap((e) => splitNameParts(normaliseName(e)));
  const normDocParts = splitNameParts(normaliseName(docName));

  let matchedCount = 0;
  let hasVariant = false;
  let hasMissing = false;

  for (const expPart of normExpected) {
    if (normDocParts.includes(expPart)) {
      matchedCount++;
      continue;
    }
    const variantIdx = normDocParts.findIndex((d) => areVariants(expPart, d));
    if (variantIdx !== -1) {
      matchedCount++;
      hasVariant = true;
      continue;
    }
    hasMissing = true;
  }

  // FAIL only when no expected part matches at all
  if (matchedCount === 0) {
    return {
      verdict: "FAIL",
      detail: `Name "${docName}" does not match expected "${expected.join(" ")}".`,
    };
  }

  // Partial match (some expected parts missing) → UNCLEAR (possible maiden name / different surname)
  if (hasMissing) {
    return { verdict: "UNCLEAR", detail: "Name differs: please confirm." };
  }

  // All expected parts matched — check for extra doc parts (possible middle names) or variants
  const haveBothComponents = expectedFirst !== null && expectedLast !== null;
  if (haveBothComponents) {
    const unmatchedDocParts = normDocParts.filter((dp) => {
      if (normExpected.includes(dp)) return false;
      if (normExpected.some((e) => areVariants(e, dp))) return false;
      return true;
    });
    if (hasVariant || unmatchedDocParts.length > 0) {
      return { verdict: "UNCLEAR", detail: "Name differs: please confirm." };
    }
  } else if (hasVariant) {
    return { verdict: "UNCLEAR", detail: "Name differs: please confirm." };
  }

  return { verdict: "OK", detail: `Name "${docName}" matches.` };
}

/** Cross-document name consistency: all names found for one person must agree. */
export interface CrossDocNameEntry {
  value: string;   // extracted name
  docTitle: string;
}

export interface CrossDocNameResult {
  verdict: NameVerdict;
  detail: string;
}

export function crossDocNameConsistency(
  entries: CrossDocNameEntry[],
): CrossDocNameResult {
  if (entries.length <= 1) {
    return { verdict: "OK", detail: "Only one document — no cross-check needed." };
  }

  // Normalise and split each entry
  const names = entries.map((e) => splitNameParts(normaliseName(e.value)));
  let anyVariantOrMiddle = false;
  let anyConflict = false;

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const r = namesConsistent(names[i], names[j]);
      if (r === "conflict") { anyConflict = true; }
      else if (r === "variant-or-middle") { anyVariantOrMiddle = true; }
    }
  }

  const list = entries.map((e) => `"${e.value}" (${e.docTitle})`).join(", ");
  if (anyConflict) {
    return { verdict: "FAIL", detail: `Names conflict across documents: ${list}.` };
  }
  if (anyVariantOrMiddle) {
    return { verdict: "UNCLEAR", detail: `Names differ slightly across documents: ${list}. Please confirm.` };
  }
  return { verdict: "OK", detail: `Names consistent across ${entries.length} documents.` };
}

type PairResult = "exact" | "variant-or-middle" | "conflict";

function namesConsistent(a: string[], b: string[]): PairResult {
  // Find the shorter set as the "base" (already normalised/lowercased)
  const [base, ext] = a.length <= b.length ? [a, b] : [b, a];

  let hasVariant = false;
  for (const part of base) {
    if (ext.includes(part)) continue;
    const vidx = ext.findIndex((e) => areVariants(part, e));
    if (vidx !== -1) { hasVariant = true; continue; }
    return "conflict";
  }

  // Extra parts in ext beyond base → possible middle name
  const extraParts = ext.filter((ep) => {
    if (base.includes(ep)) return false;
    if (base.some((b2) => areVariants(b2, ep))) return false;
    return true;
  });

  if (hasVariant || extraParts.length > 0) return "variant-or-middle";
  return "exact";
}
