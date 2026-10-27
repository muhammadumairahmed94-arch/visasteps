import { describe, it, expect } from "vitest";
import { checkExpiry, checkDateWindow, checkName, checkAmount } from "@/lib/doc-checks";

const ANCHOR = new Date(Date.UTC(2027, 0, 1)); // 1 Jan 2027
const QUOTE = "quote text long enough for the check function to accept as a verified fact snippet";

describe("checkExpiry", () => {
  it("OK when document expires well after anchor", () => {
    expect(checkExpiry("15 December 2030", QUOTE, ANCHOR).verdict).toBe("OK");
  });

  it("OK when document expires on the same day as anchor", () => {
    expect(checkExpiry("1 January 2027", QUOTE, ANCHOR).verdict).toBe("OK");
  });

  it("FAIL when document expired before anchor", () => {
    expect(checkExpiry("15 June 2026", QUOTE, ANCHOR).verdict).toBe("FAIL");
  });

  it("UNCLEAR when value is not a recognisable date", () => {
    expect(checkExpiry("not a date", QUOTE, ANCHOR).verdict).toBe("UNCLEAR");
  });

  it("parses DD/MM/YYYY — 15/12/2030 is 15 Dec 2030 → OK", () => {
    expect(checkExpiry("15/12/2030", QUOTE, ANCHOR).verdict).toBe("OK");
  });

  it("parses abbreviated month — 15 Dec 2030 → OK", () => {
    expect(checkExpiry("15 Dec 2030", QUOTE, ANCHOR).verdict).toBe("OK");
  });

  it("detail string mentions the expiry date", () => {
    const r = checkExpiry("15 December 2030", QUOTE, ANCHOR);
    expect(r.detail).toContain("15 December 2030");
  });
});

describe("checkDateWindow", () => {
  // anchor = 1 Jan 2027
  // "last 6 months" → Jul–Dec 2026
  // "last 28 days"  → 4 Dec 2026 – 1 Jan 2027

  it("OK when date is inside last 6 months", () => {
    expect(checkDateWindow("15 September 2026", QUOTE, "last 6 months", ANCHOR).verdict).toBe("OK");
  });

  it("FAIL when date is before the 6-month window", () => {
    expect(checkDateWindow("15 March 2026", QUOTE, "last 6 months", ANCHOR).verdict).toBe("FAIL");
  });

  it("FAIL when date is in the anchor month (not yet past)", () => {
    // "last 6 months" ends Dec 2026; Jan 2027 is outside
    expect(checkDateWindow("15 January 2027", QUOTE, "last 6 months", ANCHOR).verdict).toBe("FAIL");
  });

  it("OK when date is inside last 28 days", () => {
    expect(checkDateWindow("15 December 2026", QUOTE, "last 28 days", ANCHOR).verdict).toBe("OK");
  });

  it("FAIL when date is outside last 28 days", () => {
    expect(checkDateWindow("1 November 2026", QUOTE, "last 28 days", ANCHOR).verdict).toBe("FAIL");
  });

  it("OK on the anchor date itself (last 28 days)", () => {
    expect(checkDateWindow("1 January 2027", QUOTE, "last 28 days", ANCHOR).verdict).toBe("OK");
  });

  it("UNCLEAR when date is not parseable", () => {
    expect(checkDateWindow("not a date", QUOTE, "last 6 months", ANCHOR).verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when window pattern is not recognised", () => {
    expect(checkDateWindow("15 September 2026", QUOTE, "within 6 months", ANCHOR).verdict).toBe("UNCLEAR");
  });

  it("cross-year window: last 6 months from Feb 2027 → Aug–Jan", () => {
    const anchor = new Date(Date.UTC(2027, 1, 1)); // 1 Feb 2027
    expect(checkDateWindow("15 January 2027", QUOTE, "last 6 months", anchor).verdict).toBe("OK");
    expect(checkDateWindow("15 August 2026", QUOTE, "last 6 months", anchor).verdict).toBe("OK");
    expect(checkDateWindow("15 July 2026", QUOTE, "last 6 months", anchor).verdict).toBe("FAIL");
  });
});

describe("checkName", () => {
  it("OK when both first and last name match", () => {
    expect(checkName("Amina Khan", QUOTE, "Amina", "Khan").verdict).toBe("OK");
  });

  it("OK with case-insensitive match", () => {
    expect(checkName("AMINA KHAN", QUOTE, "Amina", "Khan").verdict).toBe("OK");
  });

  it("FAIL when last name differs", () => {
    expect(checkName("Amina Smith", QUOTE, "Amina", "Khan").verdict).toBe("FAIL");
  });

  it("FAIL when first name differs", () => {
    expect(checkName("John Khan", QUOTE, "Amina", "Khan").verdict).toBe("FAIL");
  });

  it("UNCLEAR when both names are null", () => {
    expect(checkName("Amina Khan", QUOTE, null, null).verdict).toBe("UNCLEAR");
  });

  it("OK when only last name is set and it matches", () => {
    expect(checkName("Amina Khan", QUOTE, null, "Khan").verdict).toBe("OK");
  });

  it("FAIL when only last name is set and it does not match", () => {
    expect(checkName("Amina Smith", QUOTE, null, "Khan").verdict).toBe("FAIL");
  });

  it("detail contains the extracted name", () => {
    const r = checkName("Amina Khan", QUOTE, "Amina", "Khan");
    expect(r.detail).toContain("Amina Khan");
  });
});

describe("checkAmount", () => {
  it("OK when document amount exceeds threshold", () => {
    expect(checkAmount("£30000", QUOTE, "£29000").verdict).toBe("OK");
  });

  it("OK when document amount exactly equals threshold", () => {
    expect(checkAmount("£29000", QUOTE, "£29000").verdict).toBe("OK");
  });

  it("FAIL when document amount is below threshold", () => {
    expect(checkAmount("£25000", QUOTE, "£29000").verdict).toBe("FAIL");
  });

  it("handles comma formatting in both value and threshold", () => {
    expect(checkAmount("£29,500", QUOTE, "£29,000").verdict).toBe("OK");
    expect(checkAmount("£28,999", QUOTE, "£29,000").verdict).toBe("FAIL");
  });

  it("UNCLEAR when value is not a parseable amount", () => {
    expect(checkAmount("unknown", QUOTE, "£29000").verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when threshold is not parseable", () => {
    expect(checkAmount("£29000", QUOTE, "at least the minimum").verdict).toBe("UNCLEAR");
  });

  it("detail string mentions the threshold", () => {
    const r = checkAmount("£30000", QUOTE, "£29000");
    expect(r.detail).toContain("£29000");
  });
});
