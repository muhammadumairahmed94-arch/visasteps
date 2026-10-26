import { describe, it, expect, vi, beforeEach } from "vitest";
import { splitHtmlSections } from "@/lib/guidance-pages";
import { filterVerified } from "@/lib/draft-runs";

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

/* ── filterVerified (quote verification) ───────────────────────────────── */

describe("filterVerified", () => {
  const sections = [
    { locator: "p1", text: "The applicant must have a salary of at least £26,200 per year." },
    { locator: "p2", text: "A payslip from the last three months must be provided as evidence." },
  ];

  it("accepts a draft whose quote appears verbatim in the cited section", () => {
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: "£26,200",
      evidenceNeeded: "Payslip",
      citationLocator: "p1",
      citationQuote: "salary of at least £26,200",
    }];
    expect(filterVerified(drafts, sections)).toHaveLength(1);
  });

  it("rejects a draft whose locator does not exist", () => {
    const drafts = [{
      whatIsChecked: "Something",
      ruleType: "OTHER" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Evidence",
      citationLocator: "p99",
      citationQuote: "some text",
    }];
    expect(filterVerified(drafts, sections)).toHaveLength(0);
  });

  it("rejects a draft whose quote does not appear in the cited section", () => {
    const drafts = [{
      whatIsChecked: "Something",
      ruleType: "OTHER" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Evidence",
      citationLocator: "p1",
      citationQuote: "this quote is completely made up",
    }];
    expect(filterVerified(drafts, sections)).toHaveLength(0);
  });

  it("normalises whitespace when comparing", () => {
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "p1",
      citationQuote: "salary  of  at  least  £26,200", // extra spaces
    }];
    expect(filterVerified(drafts, sections)).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const drafts = [{
      whatIsChecked: "Salary",
      ruleType: "MONEY_THRESHOLD" as const,
      limitOrThreshold: null,
      evidenceNeeded: "Payslip",
      citationLocator: "p1",
      citationQuote: "SALARY OF AT LEAST £26,200",
    }];
    expect(filterVerified(drafts, sections)).toHaveLength(1);
  });

  it("returns only verified drafts from a mixed list", () => {
    const drafts = [
      {
        whatIsChecked: "Salary",
        ruleType: "MONEY_THRESHOLD" as const,
        limitOrThreshold: null,
        evidenceNeeded: "Payslip",
        citationLocator: "p1",
        citationQuote: "salary of at least £26,200",
      },
      {
        whatIsChecked: "Bogus",
        ruleType: "OTHER" as const,
        limitOrThreshold: null,
        evidenceNeeded: "Nothing",
        citationLocator: "p1",
        citationQuote: "this quote does not exist in the text",
      },
    ];
    expect(filterVerified(drafts, sections)).toHaveLength(1);
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
const mockAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    requirement: {
      findFirst: (...a: unknown[]) => mockReqFindFirst(...a),
      update: (...a: unknown[]) => mockReqUpdate(...a),
    },
    checklistSuggestion: { create: (...a: unknown[]) => mockSuggestionCreate(...a) },
    guidancePage: {},
    draftRun: {},
    draftRunSource: {},
    guidanceSourceOnRoute: {},
  },
}));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/ratelimit", () => ({ limit: vi.fn() }));

const ADMIN = { id: "admin1", firmId: "firm1", role: "ADMIN" } as Parameters<typeof import("@/lib/requirements").reviewRequirement>[0];

describe("reviewRequirement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReqFindFirst.mockResolvedValue({
      id: "req1",
      firmId: "firm1",
      ruleType: "DOCUMENT_PRESENT",
      whatIsChecked: "Passport",
      evidenceNeeded: "A valid passport",
    });
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
    mockReqFindFirst.mockResolvedValue({
      id: "req2",
      firmId: "firm1",
      ruleType: "MONEY_THRESHOLD",
      whatIsChecked: "Salary £26,200",
      evidenceNeeded: "Payslip",
    });
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
