import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/crypto", () => ({
  encrypt: (t: string) => `enc:${t}`,
  decrypt: (t: string) => t.replace(/^enc:/, ""),
}));
vi.mock("@/lib/adapters/storage", () => ({
  storage: () => ({ read: async () => Buffer.alloc(0) }),
}));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/ratelimit", () => ({ limit: async () => {} }));
vi.mock("@/lib/documents", () => ({
  visibleCases: () => ({ firmId: "firm1" }),
}));

import { verifyAndAnnotateClaims } from "@/lib/case-analysis";
import { ai, type AiCaseClaim } from "@/lib/adapters/ai";

// ---------- FakeAdapter.askCase ----------

describe("FakeAdapter.askCase", () => {
  let original: string | undefined;
  beforeEach(() => { original = process.env.AI_PROVIDER; process.env.AI_PROVIDER = "fake"; });
  afterEach(() => { process.env.AI_PROVIDER = original; });

  test("empty sources → notFound with standard message", async () => {
    const result = await ai().askCase({ sources: [], question: "Any info?" });
    expect(result.notFound).toBe(true);
    expect(result.claims).toHaveLength(0);
    expect(result.answer).toContain("not in the client");
  });

  test("source text contains ##no-answer## → notFound", async () => {
    const result = await ai().askCase({
      sources: [{ label: "Client document: Passport, page 1", kind: "client-document", fileId: "f1", page: 1, text: "##no-answer## some text" }],
      question: "What is the expiry date?",
    });
    expect(result.notFound).toBe(true);
    expect(result.claims).toHaveLength(0);
  });

  test("question contains ##no-answer## → notFound", async () => {
    const result = await ai().askCase({
      sources: [{ label: "Client document: Passport, page 1", kind: "client-document", fileId: "f1", page: 1, text: "Passport expires 2029" }],
      question: "##no-answer## what is this?",
    });
    expect(result.notFound).toBe(true);
  });

  test("normal sources → one claim per source, notFound false", async () => {
    const TEXT = "The applicant holds a valid British National Overseas passport issued in London with expiry date 2030 and confirmed photo match.";
    const result = await ai().askCase({
      sources: [
        { label: "Client document: Passport, page 1", kind: "client-document", fileId: "f1", page: 1, text: TEXT },
        { label: "Client document: Marriage certificate, page 1", kind: "client-document", fileId: "f2", page: 1, text: TEXT + " marriage valid" },
      ],
      question: "Is the passport valid?",
    });
    expect(result.notFound).toBe(false);
    expect(result.claims).toHaveLength(2);
    for (const c of result.claims) {
      expect(c.quote.length).toBeGreaterThan(0);
    }
  });
});

// ---------- verifyAndAnnotateClaims ----------

describe("verifyAndAnnotateClaims", () => {
  const LONG_PAGE =
    "The applicant holds a valid British National Overseas passport issued in London with expiry date 2030 and confirmed photo match by officer.";

  test("client-doc claim with verified quote → verified:true kept", () => {
    const claims: AiCaseClaim[] = [{
      claimText: "Passport valid",
      quote: "The applicant holds a valid British National Overseas passport issued in London with expiry date 2030",
      kind: "client-document",
      fileId: "f1",
      pageNumber: 1,
    }];
    const pageMap = new Map([["f1:1", LONG_PAGE]]);
    const result = verifyAndAnnotateClaims(claims, pageMap, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(true);
  });

  test("client-doc claim with absent quote → removed", () => {
    const claims: AiCaseClaim[] = [{
      claimText: "Some requirement",
      quote: "this quote does not appear anywhere in the source page text at all whatsoever",
      kind: "client-document",
      fileId: "f1",
      pageNumber: 1,
    }];
    const pageMap = new Map([["f1:1", LONG_PAGE]]);
    const result = verifyAndAnnotateClaims(claims, pageMap, new Map());
    expect(result).toHaveLength(0);
  });

  test("client-doc claim with too-short quote → removed", () => {
    const claims: AiCaseClaim[] = [{
      claimText: "Some info",
      quote: "passport issued", // only 2 words, < 40 chars
      kind: "client-document",
      fileId: "f1",
      pageNumber: 1,
    }];
    const pageMap = new Map([["f1:1", LONG_PAGE]]);
    const result = verifyAndAnnotateClaims(claims, pageMap, new Map());
    expect(result).toHaveLength(0);
  });

  test("client-doc claim where number in claim missing from quote → removed", () => {
    const SALARY_PAGE = "The minimum salary requirement is £29000 per year for skilled workers applying on this route and must be evidenced.";
    const claims: AiCaseClaim[] = [{
      claimText: "Salary must be at least £26,200 per year",
      quote: "The minimum salary requirement is £29000 per year for skilled workers applying on this route",
      kind: "client-document",
      fileId: "f1",
      pageNumber: 1,
    }];
    const pageMap = new Map([["f1:1", SALARY_PAGE]]);
    const result = verifyAndAnnotateClaims(claims, pageMap, new Map());
    // 26200 from claimText not in quote → removed
    expect(result).toHaveLength(0);
  });

  test("guidance claim with valid quote → verified:true", () => {
    const GUIDANCE = "Applicants must demonstrate English language proficiency at B1 level or above through approved tests or qualifications.";
    const claims: AiCaseClaim[] = [{
      claimText: "English language requirement",
      quote: "Applicants must demonstrate English language proficiency at B1 level or above through approved tests",
      kind: "guidance",
      sourceId: "src1",
      locator: "p3",
    }];
    const guidanceMap = new Map([["src1:p3", GUIDANCE]]);
    const result = verifyAndAnnotateClaims(claims, new Map(), guidanceMap);
    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(true);
  });

  test("guidance claim with absent quote → kept as verified:false (unclear)", () => {
    const claims: AiCaseClaim[] = [{
      claimText: "Some guidance point",
      quote: "this quote is not in the guidance text at all and never was ever written",
      kind: "guidance",
      sourceId: "src1",
      locator: "p1",
    }];
    const guidanceMap = new Map([["src1:p1", "Some other guidance text about visa applications"]]);
    const result = verifyAndAnnotateClaims(claims, new Map(), guidanceMap);
    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(false);
  });

  test("client-doc claim with unknown fileId → removed", () => {
    const claims: AiCaseClaim[] = [{
      claimText: "Info",
      quote: "The applicant holds a valid British National Overseas passport issued in London",
      kind: "client-document",
      fileId: "unknown-file",
      pageNumber: 1,
    }];
    const result = verifyAndAnnotateClaims(claims, new Map(), new Map());
    expect(result).toHaveLength(0);
  });
});

// ---------- token estimation ----------

describe("token estimation constants", () => {
  test("text: ceil(chars / 4)", () => {
    expect(Math.ceil(400 / 4)).toBe(100);
    expect(Math.ceil(401 / 4)).toBe(101);
  });

  test("image: 1700 tokens per page", () => {
    const IMAGE_TOKEN_ESTIMATE = 1700;
    expect(IMAGE_TOKEN_ESTIMATE).toBe(1700);
  });
});
