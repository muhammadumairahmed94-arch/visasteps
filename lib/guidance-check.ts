import { parseSingleUkDate } from "./number-check";
import { isDateInWindow } from "./date-window";
import type { DocCheckResult, PayslipSummary } from "./doc-checks";

export type GuidanceCheckVerdict = "MET" | "NOT_MET" | "UNCLEAR" | "NOT_APPLICABLE";

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

/** Status of one linked checklist item for DOCUMENT_PRESENT checks. */
export interface LinkedItemStatus {
  checklistItemId: string;
  title: string;
  hasCurrentFile: boolean;
  isRedo: boolean;
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

export function parsePerson(s: string): "client" | "sponsor" | null {
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

function base(req: Requirement) {
  return {
    requirementId: req.id,
    whatIsChecked: req.whatIsChecked,
    ruleType: req.ruleType,
    limitOrThreshold: req.limitOrThreshold,
    evidenceNeeded: req.evidenceNeeded,
    citationQuote: req.citationQuote,
  };
}

function notLinked(req: Requirement): GuidanceCheckItemResult {
  return {
    ...base(req),
    verdict: "UNCLEAR",
    detail: "Requirement not linked to a checklist document — ask an admin.",
    evidenceFound: [],
  };
}

export function checkDateRequirement(
  req: Requirement,
  docs: DocCheckResult[],
  anchor: Date,
  hasLinkedItems: boolean,
): GuidanceCheckItemResult {
  if (!hasLinkedItems) return notLinked(req);

  const threshold = req.limitOrThreshold ?? "";
  const isExpiry = /expir|valid|not\s+expire/i.test(threshold);
  const windowStr = threshold.match(/last\s+\d+\s+(?:day|month)s?/i)?.[0] ?? null;

  const factKinds = isExpiry ? ["expiry-date"] : ["document-date", "expiry-date"];
  const evidence = collectEvidence(docs, factKinds);

  if (evidence.length === 0) {
    return {
      ...base(req),
      verdict: "UNCLEAR",
      detail: "No date found in the linked uploaded documents.",
      evidenceFound: [],
    };
  }

  if (isExpiry) {
    // Use the worst (earliest) expiry — if that one passes, they all pass
    const parsed = evidence
      .map((e) => ({ e, d: parseSingleUkDate(e.value) }))
      .filter((x): x is { e: GuidanceCheckEvidence; d: NonNullable<ReturnType<typeof parseSingleUkDate>> } => x.d !== null);

    if (parsed.length === 0) {
      return { ...base(req), verdict: "UNCLEAR", detail: `Could not read expiry date value.`, evidenceFound: evidence };
    }

    const worst = parsed.reduce((a, b) => {
      const da = new Date(Date.UTC(a.d.year, a.d.month - 1, a.d.day));
      const db2 = new Date(Date.UTC(b.d.year, b.d.month - 1, b.d.day));
      return da < db2 ? a : b;
    });
    const worstDate = new Date(Date.UTC(worst.d.year, worst.d.month - 1, worst.d.day));
    const met = worstDate >= anchor;
    return {
      ...base(req),
      verdict: met ? "MET" : "NOT_MET",
      detail: met
        ? `Expires ${worst.e.value} — on or after the submission date.`
        : `Expires ${worst.e.value} — before the submission date.`,
      evidenceFound: evidence,
    };
  }

  if (windowStr) {
    // Use isDateInWindow (calendar-month logic); worst = most out-of-window
    const parsed = evidence
      .map((e) => ({ e, d: parseSingleUkDate(e.value) }))
      .filter((x): x is { e: GuidanceCheckEvidence; d: NonNullable<ReturnType<typeof parseSingleUkDate>> } => x.d !== null);

    if (parsed.length === 0) {
      return { ...base(req), verdict: "UNCLEAR", detail: `Could not read date value.`, evidenceFound: evidence };
    }

    const checked = parsed.map(({ e, d }) => {
      const dateObj = new Date(Date.UTC(d.year, d.month - 1, d.day));
      const inWindow = isDateInWindow(dateObj, windowStr, anchor);
      return { e, inWindow };
    });

    const anyUnrecognised = checked.some((c) => c.inWindow === null);
    if (anyUnrecognised) {
      return {
        ...base(req),
        verdict: "UNCLEAR",
        detail: `Date window "${windowStr}" not recognised.`,
        evidenceFound: evidence,
      };
    }

    const worstFailed = checked.find((c) => c.inWindow === false);
    if (worstFailed) {
      return {
        ...base(req),
        verdict: "NOT_MET",
        detail: `Dated ${worstFailed.e.value} — outside the required window.`,
        evidenceFound: evidence,
      };
    }

    const best = checked[0];
    return {
      ...base(req),
      verdict: "MET",
      detail: `Dated ${best.e.value} — within the required window.`,
      evidenceFound: evidence,
    };
  }

  // General date — can't auto-decide
  return {
    ...base(req),
    verdict: "UNCLEAR",
    detail: `Date found: ${evidence[0].value}. Please confirm it meets the requirement.`,
    evidenceFound: evidence,
  };
}

const INCOME_CAVEAT = " Income threshold only — other conditions (e.g. length of employment) not checked.";

export function checkMoneyRequirement(
  req: Requirement,
  payslipSummary: PayslipSummary,
  hasLinkedItems: boolean,
): GuidanceCheckItemResult {
  const b = { ...base(req), evidenceFound: [] as GuidanceCheckEvidence[] };

  if (!hasLinkedItems) return { ...b, verdict: "UNCLEAR", detail: "Requirement not linked to a checklist document — ask an admin." };

  const threshold = req.limitOrThreshold ?? "";

  const amount = parseMoneyAmount(threshold);
  if (amount === null) {
    return { ...b, verdict: "UNCLEAR", detail: "Threshold amount not specified in the requirement." };
  }

  const person = parsePerson(threshold);
  if (person === null) {
    return { ...b, verdict: "UNCLEAR", detail: "Requirement does not say whose income counts (client or partner)." };
  }

  const summary = person === "client" ? payslipSummary.client : payslipSummary.sponsor;
  const label = person === "client" ? "Client" : "Partner";

  if (!summary) {
    return { ...b, verdict: "UNCLEAR", detail: `No ${label.toLowerCase()} payslip documents found in the linked checklist items.` };
  }

  if (summary.annualEstimate === null) {
    return { ...b, verdict: "UNCLEAR", detail: `${label} pay period not confirmed — cannot estimate annual income.` };
  }

  const met = summary.annualEstimate >= amount;
  const fmtEst = `£${summary.annualEstimate.toLocaleString("en-GB")}`;
  const fmtThresh = `£${amount.toLocaleString("en-GB")}`;

  const evidenceFound: GuidanceCheckEvidence[] = summary.grossEntries.map((e) => ({
    quote: e.quote,
    docTitle: e.docTitle,
    factKind: "amount",
    value: e.formattedAmount,
  }));

  return {
    ...b,
    verdict: met ? "MET" : "NOT_MET",
    detail: (met
      ? `${label} annual income estimate ${fmtEst} meets the ${fmtThresh} threshold.`
      : `${label} annual income estimate ${fmtEst} is below the ${fmtThresh} threshold.`) + INCOME_CAVEAT,
    evidenceFound,
  };
}

export function checkDocumentPresentRequirement(
  req: Requirement,
  linkedItemStatuses: LinkedItemStatus[],
): GuidanceCheckItemResult {
  const b = base(req);

  if (linkedItemStatuses.length === 0) {
    return { ...b, verdict: "UNCLEAR", detail: "Requirement not linked to a checklist document — ask an admin.", evidenceFound: [] };
  }

  const missing = linkedItemStatuses.filter((s) => !s.hasCurrentFile);
  const redo = linkedItemStatuses.filter((s) => s.hasCurrentFile && s.isRedo);
  const ok = linkedItemStatuses.filter((s) => s.hasCurrentFile && !s.isRedo);

  if (missing.length > 0) {
    return {
      ...b,
      verdict: "NOT_MET",
      detail: `Not uploaded: ${missing.map((s) => s.title).join(", ")}.`,
      evidenceFound: [],
    };
  }

  if (redo.length > 0) {
    return {
      ...b,
      verdict: "NOT_MET",
      detail: `Please redo requested for: ${redo.map((s) => s.title).join(", ")}.`,
      evidenceFound: ok.map((s) => ({ quote: s.title, docTitle: s.title, factKind: "document-title", value: s.title })),
    };
  }

  return {
    ...b,
    verdict: "MET",
    detail: `Uploaded: ${ok.map((s) => s.title).join(", ")}.`,
    evidenceFound: ok.map((s) => ({ quote: s.title, docTitle: s.title, factKind: "document-title", value: s.title })),
  };
}

export function checkNameMatchRequirement(
  req: Requirement,
  docs: DocCheckResult[],
): GuidanceCheckItemResult {
  const evidence = collectEvidence(docs, ["holder-name"]);
  return {
    ...base(req),
    verdict: "UNCLEAR",
    detail: evidence.length > 0
      ? "Name found — please review the document summary for name check results."
      : "No name found in uploaded documents.",
    evidenceFound: evidence,
  };
}

export function checkOtherRequirement(
  req: Requirement,
  docs: DocCheckResult[],
): GuidanceCheckItemResult {
  const evidence = collectEvidence(docs, [
    "expiry-date", "document-date", "amount", "holder-name",
    "date-of-birth", "passport-number", "address", "relationship",
  ]);
  return {
    ...base(req),
    verdict: "UNCLEAR",
    detail: evidence.length > 0
      ? "Evidence found — please review and confirm this requirement is met."
      : "No relevant evidence found in uploaded documents.",
    evidenceFound: evidence,
  };
}

export interface RequirementWithLinks {
  id: string;
  whatIsChecked: string;
  ruleType: string;
  limitOrThreshold: string | null;
  evidenceNeeded: string;
  citationQuote: string;
  linkedItemStatuses: LinkedItemStatus[];
  filteredDocs: DocCheckResult[];
  filteredPayslipSummary: PayslipSummary;
}

export function checkRequirement(
  req: RequirementWithLinks,
  anchor: Date,
): GuidanceCheckItemResult {
  const hasLinked = req.linkedItemStatuses.length > 0;
  switch (req.ruleType) {
    case "DATE_LIMIT":
      return checkDateRequirement(req, req.filteredDocs, anchor, hasLinked);
    case "MONEY_THRESHOLD":
      return checkMoneyRequirement(req, req.filteredPayslipSummary, hasLinked);
    case "DOCUMENT_PRESENT":
      return checkDocumentPresentRequirement(req, req.linkedItemStatuses);
    case "NAME_MATCH":
      return checkNameMatchRequirement(req, req.filteredDocs);
    default:
      return checkOtherRequirement(req, req.filteredDocs);
  }
}

export function buildGuidanceCheckResult(
  items: GuidanceCheckItemResult[],
  mentionedNotUploaded: { title: string; url: string | null }[],
): GuidanceCheckRunResult {
  const notChecked = items
    .filter((i) => i.verdict === "UNCLEAR" && i.evidenceFound.length === 0)
    .map((i) => ({ whatIsChecked: i.whatIsChecked, reason: i.detail }));

  const notMetCount = items.filter((i) => i.verdict === "NOT_MET").length;
  const unclearCount = items.filter((i) => i.verdict === "UNCLEAR").length;
  const unclearNoEvidenceCount = items.filter((i) => i.verdict === "UNCLEAR" && i.evidenceFound.length === 0).length;

  let summaryLine: string;
  const allResolved = items.every((i) => i.verdict === "MET" || i.verdict === "NOT_APPLICABLE");

  if (allResolved) {
    summaryLine = "No problems found in the uploaded guidance.";
  } else if (notMetCount > 0 && unclearCount > 0) {
    summaryLine = `${notMetCount} not met, ${unclearCount} need review (${unclearNoEvidenceCount} with no evidence found).`;
  } else if (notMetCount > 0) {
    summaryLine = `${notMetCount} not met.`;
  } else {
    summaryLine = `${unclearCount} need review (${unclearNoEvidenceCount} with no evidence found).`;
  }

  return {
    items,
    coverage: { notChecked, mentionedNotUploaded },
    summaryLine,
  };
}
