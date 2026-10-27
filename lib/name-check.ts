/**
 * Whole-word name comparison with known spelling-variant handling.
 *
 * Rules:
 * - Each expected name part must appear as a whole word in the document name.
 * - A variant (e.g. Mohammed vs Muhammad) → UNCLEAR "Name differs: please confirm".
 * - An extra part in the document name that has no match → possible middle name → UNCLEAR.
 * - A missing expected part that isn't covered by any document part → FAIL.
 * - "Ali" does NOT match "Alison" (whole-word, not substring).
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

function toLower(s: string): string {
  return s.toLowerCase();
}

/** Split a full name into individual word parts, ignoring empty strings. */
export function splitNameParts(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

/** True when two name tokens are known spelling variants of each other. */
export function areVariants(a: string, b: string): boolean {
  const al = toLower(a), bl = toLower(b);
  if (al === bl) return false; // exact match handled separately
  return NAME_VARIANT_GROUPS.some(
    (group) => group.map(toLower).includes(al) && group.map(toLower).includes(bl),
  );
}

/**
 * Compare an extracted document name against the expected name parts.
 *
 * @param docName   - The name extracted from the document (e.g. "Amina Ali Khan")
 * @param expectedFirst - Client/sponsor first name (may be null)
 * @param expectedLast  - Client/sponsor last name (may be null)
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
  const docParts = splitNameParts(docName);
  const docLower = docParts.map(toLower);

  let hasVariant = false;
  let hasMissing = false;

  for (const exp of expected) {
    const el = toLower(exp);
    if (docLower.includes(el)) {
      // exact match — good
      continue;
    }
    // Check variant match
    const variantIdx = docLower.findIndex((d) => areVariants(exp, d));
    if (variantIdx !== -1) {
      hasVariant = true;
      continue;
    }
    // No match at all → FAIL
    hasMissing = true;
  }

  if (hasMissing) {
    const exp = expected.join(" ");
    return {
      verdict: "FAIL",
      detail: `Name "${docName}" does not match expected "${exp}".`,
    };
  }

  // Only flag extra doc parts as UNCLEAR when we have a full expected name (both components).
  // If only one component is set, extra parts just mean we don't have the full name to compare.
  const haveBothComponents = expectedFirst !== null && expectedLast !== null;
  if (haveBothComponents) {
    const expectedLower = expected.map(toLower);
    const unmatchedDocParts = docParts.filter((dp) => {
      const dl = toLower(dp);
      if (expectedLower.includes(dl)) return false;
      if (expected.some((e) => areVariants(e, dp))) return false;
      return true;
    });
    if (hasVariant || unmatchedDocParts.length > 0) {
      return { verdict: "UNCLEAR", detail: "Name differs: please confirm." };
    }
  } else if (hasVariant) {
    return { verdict: "UNCLEAR", detail: "Name differs: please confirm." };
  }

  return {
    verdict: "OK",
    detail: `Name "${docName}" matches.`,
  };
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

  const names = entries.map((e) => splitNameParts(e.value));
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
  // Find the shorter set as the "base"
  const [base, ext] = a.length <= b.length ? [a, b] : [b, a];
  const extLower = ext.map(toLower);

  let hasVariant = false;
  for (const part of base) {
    const pl = toLower(part);
    if (extLower.includes(pl)) continue;
    const vidx = extLower.findIndex((e) => areVariants(part, e));
    if (vidx !== -1) { hasVariant = true; continue; }
    return "conflict";
  }

  // Extra parts in ext beyond base → possible middle name
  const baseLower = base.map(toLower);
  const extraParts = ext.filter((ep) => {
    const el = toLower(ep);
    if (baseLower.includes(el)) return false;
    if (base.some((b2) => areVariants(b2, ep))) return false;
    return true;
  });

  if (hasVariant || extraParts.length > 0) return "variant-or-middle";
  return "exact";
}
