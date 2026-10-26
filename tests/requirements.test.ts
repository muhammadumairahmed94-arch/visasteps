import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitHtmlSections } from "@/lib/guidance-pages";
import { classifyDrafts, extractRawNumbers, numbersInQuote } from "@/lib/draft-runs";

/* ── splitHtmlSections ──────────────────────────────────────────────────── */

describe("splitHtmlSections", () => {
  it("splits by h2 headings and includes heading text in the section", () => {
    const html = "<h2>Salary requirement</h2><p>Applicant must earn at least £26,200.</p><h2>Documents</h2><p>A payslip is required.</p>";
    const sections = splitHtmlSections(html);
    expect(sections.length).toBe(2);
    expect(sections[0].locator).toBe("Salary requirement");
    expect(sections[0].text).toContain("26,200");
    expect(sections[1].locator).toBe("Documents");
    expect(sections[1].text).toContain("payslip");
  });

  it("falls back to 'Main content' when there are no headings", () => {
    const html = "<p>Just some text with no headings here.</p>";
    const sections = splitHtmlSections(html);
    expect(sections.length).toBe(1);
    expect(sections[0].locator).toBe("Main content");
    expect(sections[0].text).toContain("no headings");
  });

  it("includes content before the first heading as 'Main content'", () => {
    const html = "<p>Intro paragraph with enough text for the threshold.</p><h2>Section</h2><p>Body.</p>";
    const sections = splitHtmlSections(html);
    const main = sections.find((s) => s.locator === "Main content");
    expect(main).toBeDefined();
    expect(main!.text).toContain("Intro");
  });

  it("truncates locator at 200 characters", () => {
    const long = "A".repeat(250);
    const html = `<h1>${long}</h1><p>Body text.</p>`;
    const sections = splitHtmlSections(html);
    expect(sections[0].locator.length).toBeLessThanOrEqual(200);
  });

  it("strips HTML tags from section text", () => {
    const html = "<h2>Title</h2><p>Text with <strong>bold</strong> and <em>italic</em>.</p>";
    const sections = splitHtmlSections(html);
    expect(sections[0].text).not.toContain("<strong>");
    expect(sections[0].text).toContain("bold");
  });
});

/* ── extractRawNumbers ──────────────────────────────────────────────────── */

describe("extractRawNumbers", () => {
  it("extracts a plain integer", () => {
    expect(extractRawNumbers("28 days")).toEqual(["28"]);
  });

  it("strips comma thousand-separators", () => {
    expect(extractRawNumbers("£29,000 per year")).toEqual(["29000"]);
  });

  it("handles multiple numbers", () => {
    expect(extractRawNumbers("between £26,200 and £45,000")).toEqual(["26200", "45000"]);
  });

  it("returns empty array when there are no numbers", () => {
    expect(extractRawNumbers("no numbers here")).toEqual([]);
  });

  it("preserves decimal points", () => {
    expect(extractRawNumbers("3.5 years")).toEqual(["3.5"]);
  });
});

/* ── numbersInQuote ─────────────────────────────────────────────────────── */

describe("numbersInQuote", () => {
  it("returns true when the number appears verbatim", () => {
    expect(numbersInQuote("28 days", "documents must be dated within 28 days of submission")).toBe(true);
  });

  it("returns true when formatting differs: £29,000 threshold vs £29000 in quote", () => {
    expect(numbersInQuote("£29,000", "applicant must earn at least £29000 per year")).toBe(true);
  });

  it("returns false when the number is absent from the quote", () => {
    expect(numbersInQuote("£26,200", "payslip from the last three months must be provided as evidence")).toBe(false);
  });

  it("returns true when limitOrThreshold has no numbers (check is skipped)", () => {
    expect(numbersInQuote("IELTS certificate required", "the applicant must provide an IELTS certificate")).toBe(true);
  });

  it("does not match the number as part of a larger number", () => {
    // "6" in threshold should NOT match "16" or "60" in the quote
    expect(numbersInQuote("6 months", "certificate dated within 16 months of the application")).toBe(false);
  });
});

/* ── classifyDrafts ─────────────────────────────────────────────────────── */

describe("classifyDrafts", () => {
  const SECTIONS = [
    {
      locator: "Salary",
      text: "The applicant must have a gross annual salary of at least £26,200 per year to meet the financial requirement.",
    },
    {
      locator: "Evidence",
      text: "A payslip from the last three months must be provided as primary evidence of current employment and salary.",
    },
  ];

  it("verifies a draft whose long quote appears verbatim in the cited section", () => {
    const drafts = [{
      whatIsChecked: "Minimum salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: "£26,200 per year",
      evidenceNeeded: "Payslip",
      citationLocator: "Salary",
      citationQuote: "must have a gross annual salary of at least £26,200 per year to meet",
    }];
    const { verified, rejected } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects when the cited locator does not exist", () => {
    const drafts = [{
      whatIsChecked: "Missing",
      ruleType: "OTHER" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Something",
      citationLocator: "NonExistent",
      citationQuote: "the applicant must provide documentation proving current status",
    }];
    const { verified, rejected } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("quote not found");
  });

  it("rejects when the quote does not appear in the section", () => {
    const drafts = [{
      whatIsChecked: "Bogus",
      ruleType: "OTHER" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Evidence",
      citationLocator: "Salary",
      citationQuote: "completely fabricated text not present anywhere in the cited section",
    }];
    const { rejected } = classifyDrafts(drafts, SECTIONS);
    expect(rejected[0]?.reason).toBe("quote not found");
  });

  it("rejects when the normalised quote has fewer than 8 words", () => {
    // "salary of at least £26,200" = 5 words, present in the section
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "Salary",
      citationQuote: "salary of at least £26,200",
    }];
    const { rejected } = classifyDrafts(drafts, SECTIONS);
    expect(rejected[0]?.reason).toBe("quote too short");
  });

  it("rejects when the normalised quote is shorter than 40 characters", () => {
    // 8 single-letter words = 8 words but 15 chars — fails char threshold
    const shortSections = [{ locator: "p1", text: "A B C D E F G H applicant must provide a valid document with an official stamp." }];
    const drafts = [{
      whatIsChecked: "Document",
      ruleType: "DOCUMENT_PRESENT" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Official document",
      citationLocator: "p1",
      citationQuote: "A B C D E F G H",
    }];
    const { rejected } = classifyDrafts(drafts, shortSections);
    expect(rejected[0]?.reason).toBe("quote too short");
  });

  it("rejects when a number from limitOrThreshold is absent from the quote", () => {
    // Quote is from Evidence section, which mentions no salary figure
    const drafts = [{
      whatIsChecked: "Salary threshold",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: "£26,200 per year",
      evidenceNeeded: "Payslip",
      citationLocator: "Evidence",
      citationQuote: "payslip from the last three months must be provided as primary evidence",
    }];
    const { rejected } = classifyDrafts(drafts, SECTIONS);
    expect(rejected[0]?.reason).toBe("number not in quote");
  });

  it("passes the number check when £29,000 threshold matches £29000 in the quote", () => {
    const numSections = [{
      locator: "p1",
      text: "The applicant must earn at least £29000 per year to satisfy the financial requirement for this visa route.",
    }];
    const drafts = [{
      whatIsChecked: "Minimum salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: "£29,000",
      evidenceNeeded: "Payslip",
      citationLocator: "p1",
      citationQuote: "applicant must earn at least £29000 per year to satisfy the financial requirement",
    }];
    const { verified } = classifyDrafts(drafts, numSections);
    expect(verified).toHaveLength(1);
  });

  it("passes when limitOrThreshold is null (number check skipped)", () => {
    const drafts = [{
      whatIsChecked: "Payslip",
      ruleType: "DOCUMENT_PRESENT" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "Evidence",
      citationQuote: "payslip from the last three months must be provided as primary evidence",
    }];
    const { verified } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(1);
  });

  it("normalises whitespace when comparing quotes", () => {
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "Salary",
      citationQuote: "must  have  a  gross  annual  salary  of  at  least  £26,200  per  year  to  meet",
    }];
    const { verified } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "Salary",
      citationQuote: "MUST HAVE A GROSS ANNUAL SALARY OF AT LEAST £26,200 PER YEAR TO MEET",
    }];
    const { verified } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(1);
  });

  it("classifies a mixed list correctly, returning reason for each rejection", () => {
    const drafts = [
      {
        whatIsChecked: "Good requirement",
        ruleType: "MONEY_THRESHOLD" as const,
        limitOrThreshold: null,
        evidenceNeeded: "Payslip",
        citationLocator: "Salary",
        citationQuote: "must have a gross annual salary of at least £26,200 per year to meet",
      },
      {
        whatIsChecked: "Invented quote",
        ruleType: "OTHER" as const,
        limitOrThreshold: null,
        evidenceNeeded: "Nothing",
        citationLocator: "Salary",
        citationQuote: "invented text not present anywhere in the cited document section",
      },
      {
        whatIsChecked: "Short quote",
        ruleType: "OTHER" as const,
        limitOrThreshold: null,
        evidenceNeeded: "Something",
        citationLocator: "Salary",
        citationQuote: "salary of at least",
      },
    ];
    const { verified, rejected } = classifyDrafts(drafts, SECTIONS);
    expect(verified).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected.find((r) => r.draft.whatIsChecked === "Invented quote")?.reason).toBe("quote not found");
    expect(rejected.find((r) => r.draft.whatIsChecked === "Short quote")?.reason).toBe("quote too short");
  });
});

/* ── FakeAdapter.draftRequirements ──────────────────────────────────────── */

describe("FakeAdapter.draftRequirements", () => {
  it("returns a requirement for each section with sufficient text", async () => {
    const { ai } = await import("@/lib/adapters/ai");
    const original = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "fake";
    try {
      const adapter = ai();
      const sections = [
        { locator: "p1", text: "The applicant must earn at least £26,200 per year." },
        { locator: "p2", text: "A current passport must be provided as evidence." },
      ];
      const out = await adapter.draftRequirements("Spouse Visa", "Appendix FM", sections);
      expect(out.requirements.length).toBeGreaterThan(0);
      // Every returned requirement should have a quote present in the source text
      for (const req of out.requirements) {
        const section = sections.find((s) => s.locator === req.citationLocator);
        expect(section).toBeDefined();
        expect(section!.text.toLowerCase()).toContain(req.citationQuote.toLowerCase().slice(0, 20));
      }
    } finally {
      process.env.AI_PROVIDER = original;
    }
  });

  it("returns DATE_LIMIT rule type when ##date_limit## is in the text", async () => {
    const { ai } = await import("@/lib/adapters/ai");
    const original = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "fake";
    try {
      const out = await ai().draftRequirements("Route", "Source", [
        { locator: "p1", text: "The date must be within 6 months. ##date_limit## See requirements." },
      ]);
      expect(out.requirements[0]?.ruleType).toBe("DATE_LIMIT");
    } finally {
      process.env.AI_PROVIDER = original;
    }
  });

  it("flags mentioned sources when text contains 'appendix'", async () => {
    const { ai } = await import("@/lib/adapters/ai");
    const original = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "fake";
    try {
      const out = await ai().draftRequirements("Route", "Source", [
        { locator: "p1", text: "See appendix A for more details on salary requirements." },
      ]);
      expect(out.mentionedSources.length).toBeGreaterThan(0);
    } finally {
      process.env.AI_PROVIDER = original;
    }
  });
});

/* ── reviewRequirement — supersede hook ────────────────────────────────── */

const mockReqUpdate = vi.fn();
const mockReqFindFirst = vi.fn();
const mockSuggestionCreate = vi.fn();
const mockPageFindUnique = vi.fn();
const mockAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    requirement: {
      findFirst: (...a: unknown[]) => mockReqFindFirst(...a),
      update: (...a: unknown[]) => mockReqUpdate(...a),
    },
    checklistSuggestion: { create: (...a: unknown[]) => mockSuggestionCreate(...a) },
    guidancePage: { findUnique: (...a: unknown[]) => mockPageFindUnique(...a) },
    draftRun: {},
    draftRunSource: {},
    guidanceSourceOnRoute: {},
  },
}));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/ratelimit", () => ({ limit: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decrypt: (t: string) => t, encrypt: (t: string) => t }));

const ADMIN = { id: "admin1", firmId: "firm1", role: "ADMIN" } as Parameters<typeof import("@/lib/requirements").reviewRequirement>[0];

const BASE_REQ = {
  id: "req1",
  firmId: "firm1",
  ruleType: "DOCUMENT_PRESENT",
  whatIsChecked: "Passport",
  evidenceNeeded: "A valid passport",
  citationSourceId: "src1",
  citationLocator: "p1",
  citationQuote: "original quote that is long enough to satisfy the minimum length",
  limitOrThreshold: null,
};

describe("reviewRequirement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReqFindFirst.mockResolvedValue({ ...BASE_REQ });
    mockReqUpdate.mockResolvedValue({});
    mockSuggestionCreate.mockResolvedValue({});
    mockAudit.mockResolvedValue(undefined);
  });

  it("creates a ChecklistSuggestion when approving a DOCUMENT_PRESENT requirement", async () => {
    const { reviewRequirement } = await import("@/lib/requirements");
    await reviewRequirement(ADMIN, "req1", { action: "approve" });
    expect(mockSuggestionCreate).toHaveBeenCalledOnce();
  });

  it("does NOT create a ChecklistSuggestion when rejecting", async () => {
    const { reviewRequirement } = await import("@/lib/requirements");
    await reviewRequirement(ADMIN, "req1", { action: "reject" });
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
  });

  it("does NOT create a ChecklistSuggestion when approving a non-DOCUMENT_PRESENT requirement", async () => {
    mockReqFindFirst.mockResolvedValue({ ...BASE_REQ, ruleType: "MONEY_THRESHOLD" });
    const { reviewRequirement } = await import("@/lib/requirements");
    await reviewRequirement(ADMIN, "req2", { action: "approve" });
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
  });

  it("throws a UserError when requirement is not found", async () => {
    mockReqFindFirst.mockResolvedValue(null);
    const { reviewRequirement } = await import("@/lib/requirements");
    await expect(reviewRequirement(ADMIN, "bad-id", { action: "approve" })).rejects.toThrow(/not found/i);
  });
});

/* ── editRequirement — quote validation ─────────────────────────────────── */

describe("editRequirement — quote validation", () => {
  const LONG_TEXT = "The applicant must have a gross annual salary of at least £26,200 per year to meet the financial requirement.";

  beforeEach(() => {
    vi.resetAllMocks();
    mockReqFindFirst.mockResolvedValue({
      ...BASE_REQ,
      ruleType: "MONEY_THRESHOLD",
      limitOrThreshold: "£26,200",
    });
    mockPageFindUnique.mockResolvedValue({ encryptedText: LONG_TEXT });
    mockReqUpdate.mockResolvedValue({});
    mockAudit.mockResolvedValue(undefined);
  });

  it("throws when new citationQuote is fewer than 8 words", async () => {
    const { editRequirement } = await import("@/lib/requirements");
    await expect(
      editRequirement(ADMIN, "req1", {
        citationLocator: "p1",
        citationQuote: "salary of at least £26,200",
      }),
    ).rejects.toThrow(/at least 8 words/i);
  });

  it("throws when new citationQuote is shorter than 40 characters", async () => {
    const shortSections = "A B C D E F G H applicant must provide a valid document stamp.";
    mockPageFindUnique.mockResolvedValue({ encryptedText: shortSections });
    const { editRequirement } = await import("@/lib/requirements");
    await expect(
      editRequirement(ADMIN, "req1", {
        citationLocator: "p1",
        citationQuote: "A B C D E F G H",
      }),
    ).rejects.toThrow(/at least 8 words/i);
  });

  it("throws when the threshold number is not in the new quote", async () => {
    const { editRequirement } = await import("@/lib/requirements");
    // Quote is present in the text but does not mention the salary figure
    mockPageFindUnique.mockResolvedValue({
      encryptedText: "A payslip from the last three months must be provided as primary evidence of current employment.",
    });
    await expect(
      editRequirement(ADMIN, "req1", {
        citationLocator: "p1",
        citationQuote: "payslip from the last three months must be provided as primary evidence",
      }),
    ).rejects.toThrow(/number or amount/i);
  });

  it("throws when limitOrThreshold is updated to include a number absent from the existing quote", async () => {
    mockReqFindFirst.mockResolvedValue({
      ...BASE_REQ,
      ruleType: "OTHER",
      limitOrThreshold: null,
      citationQuote: "payslip from the last three months must be provided as primary evidence",
    });
    const { editRequirement } = await import("@/lib/requirements");
    await expect(
      editRequirement(ADMIN, "req1", { limitOrThreshold: "£26,200" }),
    ).rejects.toThrow(/number or amount/i);
  });

  it("accepts a valid edit with long enough quote containing the threshold number", async () => {
    const { editRequirement } = await import("@/lib/requirements");
    await expect(
      editRequirement(ADMIN, "req1", {
        citationLocator: "p1",
        citationQuote: "must have a gross annual salary of at least £26,200 per year to meet the financial requirement",
      }),
    ).resolves.toBeUndefined();
    expect(mockReqUpdate).toHaveBeenCalledOnce();
  });
});
