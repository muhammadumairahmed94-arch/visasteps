import { describe, it, expect } from "vitest";
import {
  checkDateRequirement,
  checkMoneyRequirement,
  checkDocumentPresentRequirement,
  checkNameMatchRequirement,
  checkOtherRequirement,
  buildGuidanceCheckResult,
} from "@/lib/guidance-check";
import type { GuidanceCheckItemResult, LinkedItemStatus } from "@/lib/guidance-check";
import type { DocCheckResult, PayslipSummary } from "@/lib/doc-checks";

const ANCHOR = new Date(Date.UTC(2027, 0, 1)); // 1 Jan 2027

function makeReq(overrides: {
  ruleType?: string;
  limitOrThreshold?: string | null;
  whatIsChecked?: string;
  evidenceNeeded?: string;
} = {}) {
  return {
    id: "req-1",
    whatIsChecked: overrides.whatIsChecked ?? "Valid passport",
    ruleType: overrides.ruleType ?? "DATE_LIMIT",
    limitOrThreshold: overrides.limitOrThreshold !== undefined ? overrides.limitOrThreshold : "must not be expired",
    evidenceNeeded: overrides.evidenceNeeded ?? "Current passport",
    citationQuote: "Applicants must hold a valid passport.",
  };
}

function makeDoc(
  title: string,
  facts: { factKind: string; value: string; quote: string }[],
  uploaderKind: "CLIENT" | "SPONSOR" = "CLIENT",
): DocCheckResult {
  return {
    docId: "doc-1",
    title,
    folder: "Passport",
    uploaderKind,
    verdict: "OK",
    checks: [],
    summaryFacts: facts.map((f) => ({
      factKind: f.factKind as never,
      value: f.value,
      docTitle: title,
      uploaderKind,
      fileId: "file-1",
      pageNumber: 1,
      quote: f.quote,
    })),
  };
}

function makeLinkedItem(overrides: Partial<LinkedItemStatus> = {}): LinkedItemStatus {
  return {
    checklistItemId: "ci-1",
    title: overrides.title ?? "Passport",
    hasCurrentFile: overrides.hasCurrentFile ?? true,
    isRedo: overrides.isRedo ?? false,
  };
}

const emptyPayslip: PayslipSummary = { client: null, sponsor: null };

/* ── DATE_LIMIT ─────────────────────────────────────────────────────────── */

describe("checkDateRequirement — expiry", () => {
  it("MET when expiry is after anchor", () => {
    const doc = makeDoc("Passport", [{ factKind: "expiry-date", value: "15 December 2030", quote: "Expires 15 December 2030" }]);
    const r = checkDateRequirement(makeReq({ limitOrThreshold: "must not be expired" }), [doc], ANCHOR, true);
    expect(r.verdict).toBe("MET");
  });

  it("NOT_MET when expired before anchor", () => {
    const doc = makeDoc("Passport", [{ factKind: "expiry-date", value: "15 June 2026", quote: "Expires 15 June 2026" }]);
    const r = checkDateRequirement(makeReq({ limitOrThreshold: "must not be expired" }), [doc], ANCHOR, true);
    expect(r.verdict).toBe("NOT_MET");
  });

  it("UNCLEAR when no date found", () => {
    const r = checkDateRequirement(makeReq(), [], ANCHOR, true);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("No date found");
  });

  it("UNCLEAR when date unreadable", () => {
    const doc = makeDoc("Passport", [{ factKind: "expiry-date", value: "not a date", quote: "Expires not a date" }]);
    const r = checkDateRequirement(makeReq(), [doc], ANCHOR, true);
    expect(r.verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR and mentions admin when no linked items", () => {
    const doc = makeDoc("Passport", [{ factKind: "expiry-date", value: "15 December 2030", quote: "Expires 15 December 2030" }]);
    const r = checkDateRequirement(makeReq(), [doc], ANCHOR, false);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("ask an admin");
  });

  it("uses worst (earliest) expiry when multiple dates found", () => {
    const doc1 = makeDoc("Passport", [{ factKind: "expiry-date", value: "15 December 2030", quote: "Expires 15 December 2030" }]);
    const doc2 = makeDoc("Passport 2", [{ factKind: "expiry-date", value: "1 March 2025", quote: "Expires 1 March 2025" }]);
    const r = checkDateRequirement(makeReq({ limitOrThreshold: "must not be expired" }), [doc1, doc2], ANCHOR, true);
    expect(r.verdict).toBe("NOT_MET");
    expect(r.detail).toContain("1 March 2025");
    expect(r.evidenceFound.length).toBe(2);
  });
});

describe("checkDateRequirement — date window", () => {
  it("MET when doc date within last 3 months", () => {
    const doc = makeDoc("Bank statement", [{ factKind: "document-date", value: "15 November 2026", quote: "Dated 15 November 2026" }]);
    const r = checkDateRequirement(makeReq({ limitOrThreshold: "issued within last 3 months" }), [doc], ANCHOR, true);
    expect(r.verdict).toBe("MET");
  });

  it("NOT_MET when doc date outside window", () => {
    const doc = makeDoc("Bank statement", [{ factKind: "document-date", value: "1 June 2026", quote: "Dated 1 June 2026" }]);
    const r = checkDateRequirement(makeReq({ limitOrThreshold: "issued within last 3 months" }), [doc], ANCHOR, true);
    expect(r.verdict).toBe("NOT_MET");
  });
});

/* ── MONEY_THRESHOLD ─────────────────────────────────────────────────────── */

function makePayslip(annualEstimate: number | null, person: "client" | "sponsor"): PayslipSummary {
  const summary = annualEstimate !== null
    ? {
        grossEntries: [{
          amount: annualEstimate / 12,
          formattedAmount: `£${annualEstimate / 12}`,
          payPeriod: "monthly" as const,
          payType: "gross" as const,
          payDate: "2026-12-28",
          person: person.toUpperCase() as "CLIENT" | "SPONSOR",
          docTitle: "Payslip Dec",
          quote: `gross pay £${annualEstimate / 12} per month`,
        }],
        otherEntries: [],
        payslipCount: 1,
        dateRange: { earliest: "2026-12-28", latest: "2026-12-28" },
        annualEstimate,
        estimateBasis: "monthly" as const,
      }
    : {
        grossEntries: [],
        otherEntries: [],
        payslipCount: 0,
        dateRange: { earliest: null, latest: null },
        annualEstimate: null,
        estimateBasis: "unclear" as const,
      };
  return person === "client"
    ? { client: summary, sponsor: null }
    : { client: null, sponsor: summary };
}

describe("checkMoneyRequirement", () => {
  it("MET when sponsor income meets threshold", () => {
    const payslip = makePayslip(30_000, "sponsor");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000 per year (sponsor income)" }),
      payslip,
      true,
    );
    expect(r.verdict).toBe("MET");
    expect(r.detail).toContain("£30,000");
  });

  it("detail always includes the income caveat", () => {
    const payslip = makePayslip(30_000, "sponsor");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000 per year (sponsor income)" }),
      payslip,
      true,
    );
    expect(r.detail).toContain("Income threshold only");
    expect(r.detail).toContain("length of employment");
  });

  it("NOT_MET when income below threshold", () => {
    const payslip = makePayslip(25_000, "sponsor");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000 per year (sponsor income)" }),
      payslip,
      true,
    );
    expect(r.verdict).toBe("NOT_MET");
  });

  it("UNCLEAR when threshold has no amount", () => {
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "sufficient income" }),
      emptyPayslip,
      true,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("Threshold amount not specified");
  });

  it("UNCLEAR when no person specified", () => {
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000 per year" }),
      emptyPayslip,
      true,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("whose income");
  });

  it("UNCLEAR when no payslip uploaded for that person", () => {
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£18,600 (client income)" }),
      emptyPayslip,
      true,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("payslip");
  });

  it("UNCLEAR when annualEstimate is null (pay period unclear)", () => {
    const payslip = makePayslip(null, "client");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£18,600 (client income)" }),
      payslip,
      true,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("pay period not confirmed");
  });

  it("MET when client income meets threshold", () => {
    const payslip = makePayslip(20_000, "client");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£18,600 per year (client income)" }),
      payslip,
      true,
    );
    expect(r.verdict).toBe("MET");
  });

  it("UNCLEAR and mentions admin when no linked items", () => {
    const payslip = makePayslip(30_000, "sponsor");
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000 per year (sponsor income)" }),
      payslip,
      false,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("ask an admin");
  });

  it("sponsor payslips do NOT satisfy a marriage-certificate requirement (wrong linked items)", () => {
    // Marriage cert requirement is linked to a "Marriage certificate" checklist item
    // The payslip summary passed here is from filtered docs (sponsor payslips only)
    // But ruleType is DOCUMENT_PRESENT — tested separately in checkDocumentPresentRequirement
    // This test confirms that a MONEY check with sponsor data does not produce MET for a marriage cert
    const payslip = makePayslip(35_000, "sponsor");
    // Marriage cert requirement has no threshold → UNCLEAR
    const r = checkMoneyRequirement(
      makeReq({ ruleType: "MONEY_THRESHOLD", limitOrThreshold: null, whatIsChecked: "Marriage certificate" }),
      payslip,
      true,
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).not.toContain("meets");
  });
});

/* ── DOCUMENT_PRESENT ──────────────────────────────────────────────────── */

describe("checkDocumentPresentRequirement", () => {
  it("MET when all linked items have a current file and are not REDO", () => {
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT", whatIsChecked: "Marriage certificate" }),
      [makeLinkedItem({ title: "Marriage certificate", hasCurrentFile: true, isRedo: false })],
    );
    expect(r.verdict).toBe("MET");
    expect(r.detail).toContain("Marriage certificate");
  });

  it("NOT_MET when linked item has no file", () => {
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT", whatIsChecked: "Marriage certificate" }),
      [makeLinkedItem({ title: "Marriage certificate", hasCurrentFile: false })],
    );
    expect(r.verdict).toBe("NOT_MET");
    expect(r.detail).toContain("Not uploaded");
  });

  it("NOT_MET when linked item is REDO", () => {
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT", whatIsChecked: "Marriage certificate" }),
      [makeLinkedItem({ title: "Marriage certificate", hasCurrentFile: true, isRedo: true })],
    );
    expect(r.verdict).toBe("NOT_MET");
    expect(r.detail).toContain("redo");
  });

  it("UNCLEAR when no linked items (requirement not linked to checklist)", () => {
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT", whatIsChecked: "Marriage certificate" }),
      [],
    );
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("ask an admin");
  });

  it("sponsor payslips do NOT satisfy a marriage-certificate requirement (linked item mismatch)", () => {
    // The requirement is linked to "Marriage certificate" but we have sponsor payslip linked items
    // In practice: marriage cert requirement would be linked to a marriage-cert checklist item
    // If that item has no file (client hasn't uploaded it) → NOT_MET
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT", whatIsChecked: "Marriage certificate" }),
      [makeLinkedItem({ title: "Marriage certificate", hasCurrentFile: false, isRedo: false })],
    );
    expect(r.verdict).toBe("NOT_MET");
    // Sponsor payslips being uploaded is irrelevant — not in linked items for this requirement
  });

  it("partial: NOT_MET when one of two linked items is missing", () => {
    const r = checkDocumentPresentRequirement(
      makeReq({ ruleType: "DOCUMENT_PRESENT" }),
      [
        makeLinkedItem({ checklistItemId: "ci-1", title: "Document A", hasCurrentFile: true, isRedo: false }),
        makeLinkedItem({ checklistItemId: "ci-2", title: "Document B", hasCurrentFile: false, isRedo: false }),
      ],
    );
    expect(r.verdict).toBe("NOT_MET");
    expect(r.detail).toContain("Document B");
  });
});

/* ── person scoping ─────────────────────────────────────────────────────── */

describe("person scoping for date checks", () => {
  it("applicant passport rule only uses docs passed to it (partner passport filtered out)", () => {
    // Simulates the runner passing only filtered docs (linked to applicant's passport checklist item)
    // Partner's passport would have a different checklistItemId → not in filteredDocs
    const applicantPassport = makeDoc("Applicant passport", [
      { factKind: "expiry-date", value: "15 December 2030", quote: "Expires 15 December 2030" },
    ], "CLIENT");
    // Partner passport is NOT passed — it was filtered out by the runner
    const r = checkDateRequirement(
      makeReq({ limitOrThreshold: "must not be expired" }),
      [applicantPassport],
      ANCHOR,
      true,
    );
    expect(r.verdict).toBe("MET");
    expect(r.evidenceFound.length).toBe(1);
    expect(r.evidenceFound[0].docTitle).toBe("Applicant passport");
  });

  it("if only partner passport is in filteredDocs, a client requirement would still find that expiry", () => {
    // This is OK — the filtering is the runner's job; checkDateRequirement trusts what it's given
    const partnerPassport = makeDoc("Partner passport", [
      { factKind: "expiry-date", value: "1 January 2026", quote: "Expires 1 January 2026" },
    ], "SPONSOR");
    const r = checkDateRequirement(
      makeReq({ limitOrThreshold: "must not be expired" }),
      [partnerPassport],
      ANCHOR,
      true,
    );
    // The expiry is before the anchor → NOT_MET
    expect(r.verdict).toBe("NOT_MET");
  });
});

/* ── NAME_MATCH ─────────────────────────────────────────────────────────── */

describe("checkNameMatchRequirement", () => {
  it("UNCLEAR with evidence when name found", () => {
    const doc = makeDoc("Passport", [{ factKind: "holder-name", value: "Amina Khan", quote: "Name: Amina Khan" }]);
    const r = checkNameMatchRequirement(makeReq({ ruleType: "NAME_MATCH" }), [doc]);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.evidenceFound.length).toBeGreaterThan(0);
  });

  it("UNCLEAR with no evidence when no name found", () => {
    const r = checkNameMatchRequirement(makeReq({ ruleType: "NAME_MATCH" }), []);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.evidenceFound.length).toBe(0);
    expect(r.detail).toContain("No name found");
  });
});

/* ── OTHER ──────────────────────────────────────────────────────────────── */

describe("checkOtherRequirement", () => {
  it("UNCLEAR with evidence when facts found", () => {
    const doc = makeDoc("Employment letter", [{ factKind: "relationship", value: "employer", quote: "confirms employment" }]);
    const r = checkOtherRequirement(makeReq({ ruleType: "OTHER" }), [doc]);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.evidenceFound.length).toBeGreaterThan(0);
  });

  it("UNCLEAR with no evidence when no facts found", () => {
    const r = checkOtherRequirement(makeReq({ ruleType: "OTHER" }), []);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.evidenceFound.length).toBe(0);
  });
});

/* ── buildGuidanceCheckResult ───────────────────────────────────────────── */

describe("buildGuidanceCheckResult", () => {
  it("summaryLine says no problems when all MET", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Passport", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Passport", citationQuote: "q", verdict: "MET", detail: "ok", evidenceFound: [{ quote: "q", docTitle: "d", factKind: "expiry-date", value: "2030" }] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).toBe("No problems found in the uploaded guidance.");
  });

  it("summaryLine says no problems when all MET or NOT_APPLICABLE", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Passport", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Passport", citationQuote: "q", verdict: "MET", detail: "ok", evidenceFound: [] },
      { requirementId: "r2", whatIsChecked: "Other", ruleType: "OTHER", limitOrThreshold: null, evidenceNeeded: "Other", citationQuote: "q", verdict: "NOT_APPLICABLE", detail: "n/a", evidenceFound: [] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).toBe("No problems found in the uploaded guidance.");
  });

  it("all-UNCLEAR-no-evidence NEVER says 'No problems found'", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Passport", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Passport", citationQuote: "q", verdict: "UNCLEAR", detail: "No date found", evidenceFound: [] },
      { requirementId: "r2", whatIsChecked: "Income", ruleType: "MONEY_THRESHOLD", limitOrThreshold: null, evidenceNeeded: "Payslips", citationQuote: "q", verdict: "UNCLEAR", detail: "No payslip", evidenceFound: [] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).not.toContain("No problems found");
    expect(r.summaryLine).toContain("2");
    expect(r.summaryLine).toContain("no evidence");
  });

  it("UNCLEAR with evidence still counted in 'need review', not in 'no evidence'", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Income", ruleType: "MONEY_THRESHOLD", limitOrThreshold: null, evidenceNeeded: "Payslips", citationQuote: "q", verdict: "UNCLEAR", detail: "Please confirm", evidenceFound: [{ quote: "q", docTitle: "d", factKind: "amount", value: "£2000" }] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).not.toContain("No problems found");
    expect(r.summaryLine).toContain("1 need review");
    expect(r.summaryLine).toContain("0 with no evidence");
  });

  it("summaryLine reports NOT_MET count", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Income", ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000", evidenceNeeded: "Payslips", citationQuote: "q", verdict: "NOT_MET", detail: "below", evidenceFound: [] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).toContain("1 not met");
  });

  it("summaryLine shows combined not-met and unclear", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Income", ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000", evidenceNeeded: "Payslips", citationQuote: "q", verdict: "NOT_MET", detail: "below", evidenceFound: [] },
      { requirementId: "r2", whatIsChecked: "Income", ruleType: "MONEY_THRESHOLD", limitOrThreshold: "£29,000", evidenceNeeded: "Payslips", citationQuote: "q", verdict: "NOT_MET", detail: "below", evidenceFound: [] },
      { requirementId: "r3", whatIsChecked: "Passport", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Passport", citationQuote: "q", verdict: "UNCLEAR", detail: "No date", evidenceFound: [] },
      { requirementId: "r4", whatIsChecked: "Letter", ruleType: "OTHER", limitOrThreshold: null, evidenceNeeded: "Letter", citationQuote: "q", verdict: "UNCLEAR", detail: "Please confirm", evidenceFound: [{ quote: "q", docTitle: "d", factKind: "relationship", value: "employer" }] },
      { requirementId: "r5", whatIsChecked: "Photo ID", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Photo ID", citationQuote: "q", verdict: "UNCLEAR", detail: "No date", evidenceFound: [] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.summaryLine).toContain("2 not met");
    expect(r.summaryLine).toContain("3 need review");
    // 2 UNCLEAR with no evidence (r3, r5); r4 has evidence
    expect(r.summaryLine).toContain("2 with no evidence");
  });

  it("notChecked includes items with UNCLEAR verdict and no evidence", () => {
    const items: GuidanceCheckItemResult[] = [
      { requirementId: "r1", whatIsChecked: "Passport", ruleType: "DATE_LIMIT", limitOrThreshold: null, evidenceNeeded: "Passport", citationQuote: "q", verdict: "UNCLEAR", detail: "No date found in uploaded documents.", evidenceFound: [] },
    ];
    const r = buildGuidanceCheckResult(items, []);
    expect(r.coverage.notChecked.length).toBe(1);
    expect(r.coverage.notChecked[0].whatIsChecked).toBe("Passport");
  });

  it("mentionedNotUploaded is passed through", () => {
    const r = buildGuidanceCheckResult([], [{ title: "GOV.UK guidance", url: "https://gov.uk" }]);
    expect(r.coverage.mentionedNotUploaded.length).toBe(1);
    expect(r.coverage.mentionedNotUploaded[0].title).toBe("GOV.UK guidance");
  });
});
