/**
 * Unit tests for piiScrub — covers every pattern added to lib/eval-fixtures.ts.
 * Focuses on first-pass scrubbing only (the admin still reviews before saving).
 */

import { describe, it, expect } from "vitest";
import { piiScrub } from "@/lib/eval-fixtures";

const NO_PII: Array<{ factKind: string; value: string }> = [];

// ─── existing patterns (regression) ──────────────────────────────────────────

describe("UK postcodes", () => {
  it("SW1A 2AA → XX1 1XX", () => {
    expect(piiScrub("Address: 10 Downing Street, SW1A 2AA, London.", NO_PII))
      .toContain("XX1 1XX");
  });
  it("EC2V 8RT (no space) → XX1 1XX", () => {
    expect(piiScrub("Postcode: EC2V8RT.", NO_PII)).toContain("XX1 1XX");
  });
});

describe("Email addresses", () => {
  it("replaces email with test@example.com", () => {
    expect(piiScrub("Contact john.doe+work@employer.co.uk for details.", NO_PII))
      .toContain("test@example.com");
  });
});

describe("UK phone numbers", () => {
  it("01234 567890 format", () => {
    expect(piiScrub("Call us on 01234 567891 between 9 and 5.", NO_PII))
      .toContain("01234 567890");
  });
  it("+44 mobile", () => {
    expect(piiScrub("Mobile: +44 7700 900121.", NO_PII)).toContain("01234 567890");
  });
});

// ─── National Insurance numbers ───────────────────────────────────────────────

describe("National Insurance numbers", () => {
  it("compact NE123456A → AB000000X", () => {
    const result = piiScrub("NI number: NE123456A.", NO_PII);
    expect(result).toContain("AB000000X");
    expect(result).not.toContain("NE123456A");
  });
  it("spaced NE 12 34 56 A → AB000000X", () => {
    const result = piiScrub("National insurance: NE 12 34 56 A.", NO_PII);
    expect(result).toContain("AB000000X");
  });
  it("lowercase ne123456a → scrubbed", () => {
    const result = piiScrub("ni: ne123456a", NO_PII);
    expect(result).toContain("AB000000X");
  });
});

// ─── UK sort codes ────────────────────────────────────────────────────────────

describe("UK sort codes", () => {
  it("20-14-22 → 01-02-03", () => {
    const result = piiScrub("Sort code: 20-14-22.", NO_PII);
    expect(result).toContain("01-02-03");
    expect(result).not.toContain("20-14-22");
  });
  it("30 15 83 (space-separated) → 01-02-03", () => {
    const result = piiScrub("Sort code 30 15 83.", NO_PII);
    expect(result).toContain("01-02-03");
    expect(result).not.toContain("30 15 83");
  });
});

// ─── UK account numbers ───────────────────────────────────────────────────────

describe("UK account numbers", () => {
  it("account number 31415926 → 12345678", () => {
    const result = piiScrub("Account number 31415926.", NO_PII);
    expect(result).toContain("12345678");
    expect(result).not.toContain("31415926");
  });
  it("Account: 88776655 (colon form)", () => {
    const result = piiScrub("Account: 88776655.", NO_PII);
    expect(result).toContain("12345678");
    expect(result).not.toContain("88776655");
  });
  it("acct. 12345678 pattern", () => {
    const result = piiScrub("Acct. 87654321 at Barclays.", NO_PII);
    expect(result).toContain("12345678");
  });
});

// ─── IBANs ────────────────────────────────────────────────────────────────────

describe("IBANs", () => {
  it("GB29 NWBK 6016 1331 9268 19 → redacted", () => {
    const result = piiScrub("IBAN: GB29 NWBK 6016 1331 9268 19.", NO_PII);
    expect(result).not.toContain("GB29 NWBK");
    expect(result).toContain("GB00 BANK");
  });
  it("GB82WEST12345698765432 (compact) → redacted", () => {
    const result = piiScrub("IBAN GB82WEST12345698765432.", NO_PII);
    expect(result).not.toContain("GB82WEST");
  });
});

// ─── Dates of birth in various formats ───────────────────────────────────────

describe("Dates of birth — various formats", () => {
  it("ISO YYYY-MM-DD → 1990-01-01", () => {
    const result = piiScrub("Born: 1988-05-14.", NO_PII);
    expect(result).toContain("1990-01-01");
    expect(result).not.toContain("1988-05-14");
  });
  it("DD/MM/YYYY → 01/01/1990", () => {
    const result = piiScrub("Date of birth: 14/05/1988.", NO_PII);
    expect(result).toContain("01/01/1990");
    expect(result).not.toContain("14/05/1988");
  });
  it("DD-MM-YYYY → 01/01/1990", () => {
    const result = piiScrub("DOB: 14-05-1988.", NO_PII);
    expect(result).toContain("01/01/1990");
    expect(result).not.toContain("14-05-1988");
  });
  it("DD.MM.YYYY → 01/01/1990", () => {
    const result = piiScrub("Born 14.05.1988.", NO_PII);
    expect(result).toContain("01/01/1990");
    expect(result).not.toContain("14.05.1988");
  });
  it("DD Month YYYY → 1 January 1990", () => {
    const result = piiScrub("Date of birth: 14 May 1988.", NO_PII);
    expect(result).toContain("1 January 1990");
    expect(result).not.toContain("14 May 1988");
  });
  it("Month DD, YYYY → January 1, 1990", () => {
    const result = piiScrub("Born: May 14, 1988.", NO_PII);
    expect(result).toContain("January 1, 1990");
    expect(result).not.toContain("May 14, 1988");
  });
  it("Month DD YYYY (no comma) → January 1, 1990", () => {
    const result = piiScrub("Born: May 14 1988.", NO_PII);
    expect(result).toContain("January 1, 1990");
  });
});

// ─── MRZ lines ────────────────────────────────────────────────────────────────

describe("MRZ lines", () => {
  it("44-char type-3 MRZ line 1 → [MRZ LINE REDACTED]", () => {
    // Exactly 44 chars: P + < + GBR + QURESHI<<MOHAMMED<AHMED + 16 padding <
    const line1 = "P<GBRQURESHI<<MOHAMMED<AHMED<<<<<<<<<<<<<<<<";
    expect(line1.length).toBe(44);
    const result = piiScrub(line1, NO_PII);
    expect(result).toContain("[MRZ LINE REDACTED]");
    expect(result).not.toContain("QURESHI");
  });
  it("44-char type-3 MRZ line 2 (starts with digit) → [MRZ LINE REDACTED]", () => {
    // Exactly 44 chars: document number + check digit + nationality + DOB + gender + expiry + <fill + check
    const line2 = "1234567893GBR8807143M2804011<<<<<<<<<<<<<<<6";
    expect(line2.length).toBe(44);
    const result = piiScrub(line2, NO_PII);
    expect(result).toContain("[MRZ LINE REDACTED]");
  });
});

// ─── holder-name: tokens and MRZ form ────────────────────────────────────────

describe("holder-name scrubbing", () => {
  const pii = [{ factKind: "holder-name", value: "Mohammed Qureshi" }];

  it("replaces full name", () => {
    const result = piiScrub("Holder: Mohammed Qureshi.", pii);
    expect(result).not.toContain("Mohammed Qureshi");
  });

  it("replaces uppercase individual token", () => {
    const result = piiScrub("Name: QURESHI, MOHAMMED.", pii);
    expect(result).not.toContain("QURESHI");
  });

  it("replaces mixed-case token", () => {
    const result = piiScrub("Employee: Qureshi, Mohammed.", pii);
    expect(result).not.toContain("Qureshi");
  });

  it("replaces MRZ surname<<given form", () => {
    const result = piiScrub("QURESHI<<MOHAMMED<AHMED<<<<<<<<<<", pii);
    expect(result).not.toContain("QURESHI");
  });
});

// ─── date-of-birth from knownPii ─────────────────────────────────────────────

describe("date-of-birth from knownPii", () => {
  const pii = [{ factKind: "date-of-birth", value: "14/05/1988" }];
  it("replaces exact DOB from knownPii", () => {
    const result = piiScrub("Date of birth: 14/05/1988.", pii);
    expect(result).not.toContain("14/05/1988");
    expect(result).toContain("01/01/1990");
  });
});

// ─── passport-number from knownPii ───────────────────────────────────────────

describe("passport-number from knownPii", () => {
  const pii = [{ factKind: "passport-number", value: "AB123456" }];
  it("replaces passport number case-insensitively", () => {
    const result = piiScrub("Passport No. AB123456.", pii);
    expect(result).not.toContain("AB123456");
    expect(result).toContain("XX000000");
  });
});

// ─── address from knownPii ────────────────────────────────────────────────────

describe("address from knownPii", () => {
  const pii = [{ factKind: "address", value: "12 Oak Street, Manchester" }];
  it("replaces address", () => {
    const result = piiScrub("Lives at: 12 Oak Street, Manchester.", pii);
    expect(result).not.toContain("Oak Street");
    expect(result).toContain("[ADDRESS REDACTED]");
  });
});
