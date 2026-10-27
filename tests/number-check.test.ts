import { describe, it, expect } from "vitest";
import { numbersMatch } from "@/lib/number-check";

describe("numbersMatch — page reference stripping", () => {
  it("ignores 'page N' in claim text", () => {
    expect(numbersMatch("Evidence from Client document, page 1", "The applicant holds a valid passport issued by the UK government.")).toBe(true);
  });

  it("ignores 'pages N-M' in claim text", () => {
    expect(numbersMatch("See pages 2-3 for details", "This section explains the salary requirement for the skilled worker route.")).toBe(true);
  });

  it("ignores 'p. N' in claim text", () => {
    expect(numbersMatch("Requirement noted at p. 5", "The applicant must demonstrate continuous employment for the required period.")).toBe(true);
  });

  it("ignores 'pp. N-M' in claim text", () => {
    expect(numbersMatch("Cross-reference pp. 10-12", "Guidance from the Home Office specifies the required documentation for the application.")).toBe(true);
  });

  it("does not lose a real number when a page ref is also present", () => {
    // £26,200 is a real number; "page 3" is a page ref that should be stripped
    expect(numbersMatch("Minimum salary £26,200, page 3", "applicant must earn at least £26200 per year to qualify for the skilled worker route")).toBe(true);
    // And fails when the real number is absent
    expect(numbersMatch("Minimum salary £26,200, page 3", "applicant must provide a payslip from the last three months as primary evidence")).toBe(false);
  });
});

describe("numbersMatch — UK date matching (same format)", () => {
  it("matches DD/MM/YYYY in claim against DD/MM/YYYY in quote", () => {
    expect(numbersMatch("Visa issued 12/03/2027", "The document shows a visa issued on 12/03/2027 by the Home Office.")).toBe(true);
  });

  it("matches DD.MM.YYYY in claim against DD.MM.YYYY in quote", () => {
    expect(numbersMatch("Valid from 12.03.2027", "The certificate is valid from 12.03.2027 and expires three years later.")).toBe(true);
  });

  it("matches named month in claim against named month in quote", () => {
    expect(numbersMatch("Decision dated 12 March 2027", "The Home Office decision dated 12 March 2027 grants leave to remain.")).toBe(true);
  });

  it("matches abbreviated month in claim against abbreviated month in quote", () => {
    expect(numbersMatch("Issued 12 Mar 2027", "Leave to remain granted, document issued 12 Mar 2027, valid for thirty months.")).toBe(true);
  });
});

describe("numbersMatch — UK date cross-format matching", () => {
  it("DD/MM/YYYY in claim matches named month in quote", () => {
    expect(numbersMatch("Visa issued 12/03/2027", "The visa was issued on 12 March 2027 by the issuing authority.")).toBe(true);
  });

  it("named month in claim matches DD/MM/YYYY in quote", () => {
    expect(numbersMatch("Visa issued 12 March 2027", "Document reference: visa issued 12/03/2027 and valid for thirty months.")).toBe(true);
  });

  it("DD.MM.YYYY in claim matches named month in quote", () => {
    expect(numbersMatch("Decision 12.03.2027", "The refusal notice dated 12 March 2027 sets out the grounds for rejection.")).toBe(true);
  });

  it("abbreviated month in claim matches DD/MM/YYYY in quote", () => {
    expect(numbersMatch("Certificate dated 12 Mar 2027", "Certificate was issued on 12/03/2027 and bears the official stamp.")).toBe(true);
  });
});

describe("numbersMatch — UK date order (DD/MM, NOT MM/DD)", () => {
  it("03/12/2027 does NOT match 12 March 2027 (3 Dec ≠ 12 Mar)", () => {
    // 03/12/2027 = 3rd December 2027 in UK format
    expect(numbersMatch("03/12/2027", "The applicant was notified on 12 March 2027 of the decision to grant leave.")).toBe(false);
  });

  it("12/03/2027 DOES match 12 March 2027 (12 Mar = 12 Mar)", () => {
    expect(numbersMatch("12/03/2027", "The applicant was notified on 12 March 2027 of the decision to grant leave.")).toBe(true);
  });

  it("03/12/2027 matches 3 December 2027 (correct pairing)", () => {
    expect(numbersMatch("03/12/2027", "The visa expires on 3 December 2027 as stated in the grant letter.")).toBe(true);
  });

  it("wrong year fails", () => {
    expect(numbersMatch("12/03/2027", "The applicant was notified on 12 March 2028 of the decision.")).toBe(false);
  });

  it("wrong day fails", () => {
    expect(numbersMatch("15/03/2027", "The applicant was notified on 12 March 2027 of the decision.")).toBe(false);
  });
});

describe("numbersMatch — plain numbers", () => {
  it("returns true when the number appears verbatim", () => {
    expect(numbersMatch("28 days", "documents must be dated within 28 days of submission to the tribunal")).toBe(true);
  });

  it("returns true with comma formatting difference: £29,000 threshold vs £29000 in quote", () => {
    expect(numbersMatch("£29,000", "the applicant must earn at least £29000 per year to satisfy the income requirement")).toBe(true);
  });

  it("returns false when the number is absent from the quote", () => {
    expect(numbersMatch("£26,200", "payslip from the last three months must be provided as evidence of current salary")).toBe(false);
  });

  it("returns true when claim has no numbers at all", () => {
    expect(numbersMatch("IELTS certificate required", "the applicant must provide a valid IELTS certificate from an approved test centre")).toBe(true);
  });

  it("does not match a number as part of a larger number", () => {
    // "6" should NOT match "16" or "60"
    expect(numbersMatch("6 months", "certificate dated within 16 months of the application is required by the guidance")).toBe(false);
  });
});

describe("numbersMatch — combined: date + plain number", () => {
  it("passes when both a date and a plain number appear in quote", () => {
    expect(
      numbersMatch(
        "Salary £26,200 verified on 12 March 2027",
        "The payslip confirms a salary of at least £26,200 per year and is dated 12/03/2027.",
      ),
    ).toBe(true);
  });

  it("fails when the plain number is absent even if the date matches", () => {
    expect(
      numbersMatch(
        "Salary £26,200 verified on 12 March 2027",
        "The payslip was reviewed on 12 March 2027 but does not state the salary figure.",
      ),
    ).toBe(false);
  });

  it("fails when the date is absent even if the plain number matches", () => {
    expect(
      numbersMatch(
        "Salary £26,200 verified on 12 March 2027",
        "The payslip shows a gross annual salary of £26,200 but carries no date.",
      ),
    ).toBe(false);
  });
});
