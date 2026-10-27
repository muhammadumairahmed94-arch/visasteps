import { describe, it, expect } from "vitest";
import { checkExpiry, checkDateWindow, checkName, checkMrz, buildPayslipSummary } from "@/lib/doc-checks";
import type { PayslipEntry } from "@/lib/doc-checks";

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
  it("OK when date is inside last 6 months", () => {
    expect(checkDateWindow("15 September 2026", QUOTE, "last 6 months", ANCHOR).verdict).toBe("OK");
  });

  it("FAIL when date is before the 6-month window", () => {
    expect(checkDateWindow("15 March 2026", QUOTE, "last 6 months", ANCHOR).verdict).toBe("FAIL");
  });

  it("FAIL when date is in the anchor month (not yet past)", () => {
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
    const anchor = new Date(Date.UTC(2027, 1, 1));
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

  it("UNCLEAR when last name differs but first matches (partial match)", () => {
    expect(checkName("Amina Smith", QUOTE, "Amina", "Khan").verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when first name differs but last matches (partial match)", () => {
    expect(checkName("John Khan", QUOTE, "Amina", "Khan").verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when both names are null", () => {
    expect(checkName("Amina Khan", QUOTE, null, null).verdict).toBe("UNCLEAR");
  });

  it("OK when only last name is set and it matches (extra first-name part is not flagged)", () => {
    expect(checkName("Amina Khan", QUOTE, null, "Khan").verdict).toBe("OK");
  });

  it("FAIL when only last name is set and no part matches", () => {
    expect(checkName("James Jones", QUOTE, null, "Khan").verdict).toBe("FAIL");
  });

  it("UNCLEAR when variant spelling with both names set", () => {
    expect(checkName("Mohammed Khan", QUOTE, "Muhammad", "Khan").verdict).toBe("UNCLEAR");
  });

  it("UNCLEAR when extra middle name and both names set", () => {
    expect(checkName("Amina Begum Khan", QUOTE, "Amina", "Khan").verdict).toBe("UNCLEAR");
  });

  it("'Alison Khan' vs 'Ali' + 'Khan': Khan matches → UNCLEAR (not FAIL)", () => {
    expect(checkName("Alison Khan", QUOTE, "Ali", "Khan").verdict).toBe("UNCLEAR");
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

/* ── buildPayslipSummary ─────────────────────────────────────────────────── */

function makeEntry(overrides: Partial<PayslipEntry>): PayslipEntry {
  return {
    amount: 2400,
    formattedAmount: "£2,400",
    payPeriod: "monthly",
    payType: "gross",
    payDate: null,
    person: "CLIENT",
    docTitle: "Payslip",
    quote: "gross pay £2,400 per month",
    ...overrides,
  };
}

describe("buildPayslipSummary — 6 gross monthly payslips", () => {
  const entries = Array.from({ length: 6 }, (_, i) =>
    makeEntry({ payDate: `2026-0${i + 1}-28`, docTitle: `Payslip ${i + 1}` }),
  );
  const s = buildPayslipSummary(entries);

  it("produces a client summary", () => {
    expect(s.client).not.toBeNull();
    expect(s.sponsor).toBeNull();
  });

  it("annual estimate = average monthly × 12 = £28,800", () => {
    expect(s.client?.annualEstimate).toBe(28_800); // 2400 * 12
  });

  it("payslipCount = 6", () => {
    expect(s.client?.payslipCount).toBe(6);
  });

  it("estimateBasis = 'monthly'", () => {
    expect(s.client?.estimateBasis).toBe("monthly");
  });

  it("dateRange spans first to last payslip", () => {
    expect(s.client?.dateRange.earliest).toBe("2026-01-28");
    expect(s.client?.dateRange.latest).toBe("2026-06-28");
  });
});

describe("buildPayslipSummary — mixed gross and net entries", () => {
  const entries = [
    makeEntry({ amount: 2400, payType: "gross", payDate: "2026-01-28", quote: "gross pay £2,400 per month" }),
    makeEntry({ amount: 2000, payType: "net", payDate: "2026-01-28", quote: "net pay £2,000 per month" }),
    makeEntry({ amount: 2400, payType: "gross", payDate: "2026-02-28", quote: "gross pay £2,400 per month" }),
    makeEntry({ amount: 2000, payType: "net", payDate: "2026-02-28", quote: "net pay £2,000 per month" }),
  ];
  const s = buildPayslipSummary(entries);

  it("only gross entries used for estimate — annual = £28,800", () => {
    expect(s.client?.annualEstimate).toBe(28_800);
  });

  it("grossEntries has only the 2 gross entries", () => {
    expect(s.client?.grossEntries.length).toBe(2);
  });

  it("otherEntries contains the 2 net entries", () => {
    expect(s.client?.otherEntries.length).toBe(2);
    expect(s.client?.otherEntries.every((e) => e.payType === "net")).toBe(true);
  });
});

describe("buildPayslipSummary — duplicate payslip (same pay date)", () => {
  const entries = [
    makeEntry({ amount: 2400, payDate: "2026-01-28", docTitle: "Payslip Jan (copy 1)" }),
    makeEntry({ amount: 2400, payDate: "2026-01-28", docTitle: "Payslip Jan (copy 2)" }),
    makeEntry({ amount: 2600, payDate: "2026-02-28", docTitle: "Payslip Feb" }),
  ];
  const s = buildPayslipSummary(entries);

  it("duplicate is deduped — payslipCount = 2", () => {
    expect(s.client?.payslipCount).toBe(2);
  });

  it("annual estimate uses average of 2 unique entries: (2400+2600)/2*12 = £30,000", () => {
    expect(s.client?.annualEstimate).toBe(30_000);
  });
});

describe("buildPayslipSummary — sponsor payslips are separate", () => {
  const entries = [
    makeEntry({ person: "CLIENT", amount: 2400, payDate: "2026-01-28" }),
    makeEntry({ person: "SPONSOR", amount: 3000, payDate: "2026-01-28" }),
  ];
  const s = buildPayslipSummary(entries);

  it("client and sponsor summaries are separate", () => {
    expect(s.client).not.toBeNull();
    expect(s.sponsor).not.toBeNull();
  });

  it("client annual estimate = 2400 × 12", () => {
    expect(s.client?.annualEstimate).toBe(28_800);
  });

  it("sponsor annual estimate = 3000 × 12", () => {
    expect(s.sponsor?.annualEstimate).toBe(36_000);
  });
});

describe("buildPayslipSummary — unknown pay period → UNCLEAR", () => {
  const entries = [
    makeEntry({ payPeriod: "unknown", payType: "gross", payDate: "2026-01-28" }),
  ];
  const s = buildPayslipSummary(entries);

  it("estimateBasis = 'unclear' when pay period unknown", () => {
    expect(s.client?.estimateBasis).toBe("unclear");
    expect(s.client?.annualEstimate).toBeNull();
  });
});
