import { parseSingleUkDate } from "./number-check";
import type { DocCheckResult, PayslipSummary } from "./doc-checks";

export type GuidanceCheckVerdict = "MET" | "NOT_MET" | "UNCLEAR";

export interface GuidanceCheckEvidence {
  quote: string;
  docTitle: string;
  factKind: string;
  value: string;
}

export interface GuidanceCheckItemResult {
  requirementId: string;
  whatIsChecked: string;
  ruleType: string;
  limitOrThreshold: string | null;
  evidenceNeeded: string;
  citationQuote: string;
  verdict: GuidanceCheckVerdict;
  detail: string;
  evidenceFound: GuidanceCheckEvidence[];
}

export interface GuidanceCheckCoverage {
  notChecked: { whatIsChecked: string; reason: string }[];
  mentionedNotUploaded: { title: string; url: string | null }[];
}

export interface GuidanceCheckRunResult {
  items: GuidanceCheckItemResult[];
  coverage: GuidanceCheckCoverage;
  summaryLine: string;
}

interface Requirement {
  id: string;
  whatIsChecked: string;
  ruleType: string;
  limitOrThreshold: string | null;
  evidenceNeeded: string;
  citationQuote: string;
}

function parseMoneyAmount(s: string): number | null {
  const m = s.match(/£[\d,]+(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/[£,]/g, ""));
  return isNaN(n) ? null : n;
}

function parsePerson(s: string): "client" | "sponsor" | null {
  const lower = s.toLowerCase();
  if (/\b(sponsor|partner)\b/.test(lower)) return "sponsor";
  if (/\b(client|applicant)\b/.test(lower)) return "client";
  return null;
}

function collectEvidence(docs: DocCheckResult[], factKinds: string[]): GuidanceCheckEvidence[] {
  const out: GuidanceCheckEvidence[] = [];
  for (const doc of docs) {
    for (const f of doc.summaryFacts) {
      if (factKinds.includes(f.factKind)) {
        out.push({ quote: f.quote, docTitle: doc.title, factKind: f.factKind, value: f.value });
      }
    }
  }
  return out;
}

export function checkDateRequirement(
  req: Requirement,
  docs: DocCheckResult[],
  anchor: Date,
): GuidanceCheckItemResult {
  const threshold = req.limitOrThreshold ?? "";
  const isExpiry = /expir|valid|not\s+expire/i.test(threshold);
  const isWindow = /last\s+\d+\s+(day|week|month)/i.test(threshold);

  const evidence = collectEvidence(docs, isExpiry ? ["expiry-date"] : ["document-date", "expiry-date"]);

  if (evidence.length === 0) {
    return {
      requirementId: req.id,
      whatIsChecked: req.whatIsChecked,
      ruleType: req.ruleType,
      limitOrThreshold: req.limitOrThreshold,
      evidenceNeeded: req.evidenceNeeded,
      citationQuote: req.citationQuote,
      verdict: "UNCLEAR",
      detail: "No date found in uploaded documents.",
      evidenceFound: [],
    };
  }

  // Check first relevant date found
  const first = evidence[0];
  const parsed = parseSingleUkDate(first.value);
  if (!parsed) {
    return {
      requirementId: req.id,
      whatIsChecked: req.whatIsChecked,
      ruleType: req.ruleType,
      limitOrThreshold: req.limitOrThreshold,
      evidenceNeeded: req.evidenceNeeded,
      citationQuote: req.citationQuote,
      verdict: "UNCLEAR",
      detail: `Could not read the date value: "${first.value}".`,
      evidenceFound: evidence,
    };
  }

  const dateObj = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));

  if (isExpiry) {
    const met = dateObj >= anchor;
    return {
      requirementId: req.id,
      whatIsChecked: req.whatIsChecked,
      ruleType: req.ruleType,
      limitOrThreshold: req.limitOrThreshold,
      evidenceNeeded: req.evidenceNeeded,
      citationQuote: req.citationQuote,
      verdict: met ? "MET" : "NOT_MET",
      detail: met
        ? `Expires ${first.value} — on or after the submission date.`
        : `Expires ${first.value} — before the submission date.`,
      evidenceFound: evidence,
    };
  }

  if (isWindow) {
    const windowMatch = threshold.match(/last\s+(\d+)\s+(day|week|month)/i);
    if (!windowMatch) {
      return {
        requirementId: req.id,
        whatIsChecked: req.whatIsChecked,
        ruleType: req.ruleType,
        limitOrThreshold: req.limitOrThreshold,
        evidenceNeeded: req.evidenceNeeded,
        citationQuote: req.citationQuote,
        verdict: "UNCLEAR",
        detail: `Date window "${threshold}" not recognised.`,
        evidenceFound: evidence,
      };
    }
    const n = parseInt(windowMatch[1], 10);
    const unit = windowMatch[2].toLowerCase();
    let windowMs: number;
    if (unit === "day") windowMs = n * 86_400_000;
    else if (unit === "week") windowMs = n * 7 * 86_400_000;
    else windowMs = n * 30 * 86_400_000;

    const cutoff = new Date(anchor.getTime() - windowMs);
    const met = dateObj >= cutoff && dateObj <= anchor;
    return {
      requirementId: req.id,
      whatIsChecked: req.whatIsChecked,
      ruleType: req.ruleType,
      limitOrThreshold: req.limitOrThreshold,
      evidenceNeeded: req.evidenceNeeded,
      citationQuote: req.citationQuote,
      verdict: met ? "MET" : "NOT_MET",
      detail: met
        ? `Dated ${first.value} — within the required window.`
        : `Dated ${first.value} — outside the required window.`,
      evidenceFound: evidence,
    };
  }

  // General date check: just show the date as evidence
  return {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
    verdict: "UNCLEAR",
    detail: `Date found: ${first.value}. Please confirm it meets the requirement.`,
    evidenceFound: evidence,
  };
}

export function checkMoneyRequirement(
  req: Requirement,
  payslipSummary: PayslipSummary,
): GuidanceCheckItemResult {
  const base = {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
    evidenceFound: [] as GuidanceCheckEvidence[],
  };

  const threshold = req.limitOrThreshold ?? "";

  const amount = parseMoneyAmount(threshold);
  if (amount === null) {
    return { ...base, verdict: "UNCLEAR", detail: "Threshold amount not specified in the requirement." };
  }

  const person = parsePerson(threshold);
  if (person === null) {
    return { ...base, verdict: "UNCLEAR", detail: "Requirement does not say whose income counts (client or partner)." };
  }

  const summary = person === "client" ? payslipSummary.client : payslipSummary.sponsor;
  const label = person === "client" ? "Client" : "Partner";

  if (!summary) {
    return { ...base, verdict: "UNCLEAR", detail: `No ${label.toLowerCase()} payslip documents uploaded.` };
  }

  if (summary.annualEstimate === null) {
    return { ...base, verdict: "UNCLEAR", detail: `${label} pay period not confirmed — cannot estimate annual income.` };
  }

  const met = summary.annualEstimate >= amount;
  const formatted = `£${summary.annualEstimate.toLocaleString("en-GB")}`;
  const threshold_formatted = `£${amount.toLocaleString("en-GB")}`;

  // Collect payslip evidence entries
  const evidenceFound: GuidanceCheckEvidence[] = summary.grossEntries.map((e) => ({
    quote: e.quote,
    docTitle: e.docTitle,
    factKind: "amount",
    value: e.formattedAmount,
  }));

  return {
    ...base,
    verdict: met ? "MET" : "NOT_MET",
    detail: met
      ? `${label} annual income estimate ${formatted} meets the ${threshold_formatted} threshold.`
      : `${label} annual income estimate ${formatted} is below the ${threshold_formatted} threshold.`,
    evidenceFound,
  };
}

export function checkDocumentPresentRequirement(
  req: Requirement,
  docs: DocCheckResult[],
): GuidanceCheckItemResult {
  const base = {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
  };

  if (docs.length === 0) {
    return { ...base, verdict: "NOT_MET", detail: "No documents have been uploaded.", evidenceFound: [] };
  }

  // Keywords from whatIsChecked / evidenceNeeded
  const keywords = (req.whatIsChecked + " " + req.evidenceNeeded)
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const matching = docs.filter((d) => {
    const haystack = (d.title + " " + d.folder).toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });

  if (matching.length > 0) {
    return {
      ...base,
      verdict: "MET",
      detail: `Found: ${matching.map((d) => d.title).join(", ")}.`,
      evidenceFound: matching.map((d) => ({
        quote: d.title,
        docTitle: d.title,
        factKind: "document-title",
        value: d.title,
      })),
    };
  }

  return {
    ...base,
    verdict: "NOT_MET",
    detail: "No matching document found in the uploaded files.",
    evidenceFound: [],
  };
}

export function checkNameMatchRequirement(
  req: Requirement,
  docs: DocCheckResult[],
): GuidanceCheckItemResult {
  const base = {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
  };

  const evidence = collectEvidence(docs, ["holder-name"]);

  if (evidence.length === 0) {
    return { ...base, verdict: "UNCLEAR", detail: "No name found in uploaded documents.", evidenceFound: [] };
  }

  return {
    ...base,
    verdict: "UNCLEAR",
    detail: "Name found — please review the document summary for name check results.",
    evidenceFound: evidence,
  };
}

export function checkOtherRequirement(
  req: Requirement,
  docs: DocCheckResult[],
): GuidanceCheckItemResult {
  const base = {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
  };

  // Collect all facts as potential evidence
  const evidence = collectEvidence(docs, [
    "expiry-date", "document-date", "amount", "holder-name",
    "date-of-birth", "passport-number", "address", "relationship",
  ]);

  if (evidence.length === 0) {
    return {
      ...base,
      verdict: "UNCLEAR",
      detail: "No relevant evidence found in uploaded documents.",
      evidenceFound: [],
    };
  }

  return {
    ...base,
    verdict: "UNCLEAR",
    detail: "Evidence found — please review and confirm this requirement is met.",
    evidenceFound: evidence,
  };
}

export function checkRequirement(
  req: Requirement,
  docs: DocCheckResult[],
  payslipSummary: PayslipSummary,
  anchor: Date,
): GuidanceCheckItemResult {
  switch (req.ruleType) {
    case "DATE_LIMIT":
      return checkDateRequirement(req, docs, anchor);
    case "MONEY_THRESHOLD":
      return checkMoneyRequirement(req, payslipSummary);
    case "DOCUMENT_PRESENT":
      return checkDocumentPresentRequirement(req, docs);
    case "NAME_MATCH":
      return checkNameMatchRequirement(req, docs);
    default:
      return checkOtherRequirement(req, docs);
  }
}

export function buildGuidanceCheckResult(
  items: GuidanceCheckItemResult[],
  mentionedNotUploaded: { title: string; url: string | null }[],
): GuidanceCheckRunResult {
  const notChecked = items
    .filter((i) => i.verdict === "UNCLEAR" && i.evidenceFound.length === 0)
    .map((i) => ({ whatIsChecked: i.whatIsChecked, reason: i.detail }));

  const problemCount = items.filter((i) => i.verdict === "NOT_MET").length;
  const unclearCount = items.filter(
    (i) => i.verdict === "UNCLEAR" && i.evidenceFound.length > 0,
  ).length;

  let summaryLine: string;
  if (problemCount === 0 && unclearCount === 0) {
    summaryLine = "No problems found in the uploaded guidance.";
  } else if (problemCount > 0) {
    summaryLine = `${problemCount} requirement${problemCount === 1 ? "" : "s"} not met.`;
  } else {
    summaryLine = `${unclearCount} requirement${unclearCount === 1 ? "" : "s"} need${unclearCount === 1 ? "s" : ""} review.`;
  }

  return {
    items,
    coverage: { notChecked, mentionedNotUploaded },
    summaryLine,
  };
}
