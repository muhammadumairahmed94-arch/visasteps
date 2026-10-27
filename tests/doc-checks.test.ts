import { describe, it, expect } from "vitest";
import { checkExpiry, checkDateWindow, checkName, checkMrz } from "@/lib/doc-checks";

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
  it("OK when both first and last name match exactly", () => {
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

  it("OK when only last name is set and it matches (extra first-name part is not flagged)", () => {
    expect(checkName("Amina Khan", QUOTE, null, "Khan").verdict).toBe("OK");
  });

  it("FAIL when only last name is set and it does not match", () => {
    expect(checkName("Amina Smith", QUOTE, null, "Khan").verdict).toBe("FAIL");
  });

  it("UNCLEAR when variant spelling with both names set", () => {
    expect(checkName("Mohammed Khan", QUOTE, "Muhammad", "Khan").verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when extra middle name and both names set", () => {
    expect(checkName("Amina Begum Khan", QUOTE, "Amina", "Khan").verdict).toBe("UNCLEAR");
  });

  it("Ali does NOT match Alison — whole-word only", () => {
    expect(checkName("Alison Khan", QUOTE, "Ali", "Khan").verdict).toBe("FAIL");
  });
});

describe("checkMrz", () => {
  const VALID_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

  it("OK when all check digits pass", () => {
    const mrzValue = "P<UTOSURNAME<<GIVENNAMES<<<<<<<<<<<<<<<<<<<<\n" + VALID_LINE2;
    expect(checkMrz(mrzValue, QUOTE).verdict).toBe("OK");
  });

  it("UNCLEAR when a check digit fails (possible misread)", () => {
    const badLine2 = VALID_LINE2.slice(0, 9) + "9" + VALID_LINE2.slice(10);
    const mrzValue = "P<UTOSURNAME<<GIVENNAMES<<<<<<<<<<<<<<<<<<<<\n" + badLine2;
    const r = checkMrz(mrzValue, QUOTE);
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("misread");
  });

  it("UNCLEAR for unreadable MRZ (wrong format)", () => {
    expect(checkMrz("not an mrz", QUOTE).verdict).toBe("UNCLEAR");
  });
});
