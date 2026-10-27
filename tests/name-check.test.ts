import { describe, it, expect } from "vitest";
import { compareNames, crossDocNameConsistency, areVariants, splitNameParts } from "@/lib/name-check";

describe("splitNameParts", () => {
  it("splits simple two-part name", () => {
    expect(splitNameParts("Amina Khan")).toEqual(["Amina", "Khan"]);
  });
  it("handles extra whitespace", () => {
    expect(splitNameParts("  John  Smith  ")).toEqual(["John", "Smith"]);
  });
  it("handles three-part name", () => {
    expect(splitNameParts("Ali Hassan Khan")).toEqual(["Ali", "Hassan", "Khan"]);
  });
});

describe("areVariants", () => {
  it("Muhammad and Mohammed are variants", () => {
    expect(areVariants("Muhammad", "Mohammed")).toBe(true);
  });
  it("Mohamed and Muhammed are variants", () => {
    expect(areVariants("Mohamed", "Muhammed")).toBe(true);
  });
  it("case-insensitive variant check", () => {
    expect(areVariants("muhammad", "MOHAMMED")).toBe(true);
  });
  it("exact match is not a variant (handled separately)", () => {
    expect(areVariants("Muhammad", "Muhammad")).toBe(false);
  });
  it("Ali and Alison are NOT variants", () => {
    expect(areVariants("Ali", "Alison")).toBe(false);
  });
  it("completely unrelated names are not variants", () => {
    expect(areVariants("John", "Khan")).toBe(false);
  });
  it("Katherine and Catherine are variants", () => {
    expect(areVariants("Katherine", "Catherine")).toBe(true);
  });
});

describe("compareNames — exact match", () => {
  it("OK when both first and last match exactly", () => {
    expect(compareNames("Amina Khan", "Amina", "Khan").verdict).toBe("OK");
  });
  it("OK is case-insensitive", () => {
    expect(compareNames("AMINA KHAN", "Amina", "Khan").verdict).toBe("OK");
  });
  it("OK when only last name is set and matches", () => {
    expect(compareNames("John Khan", null, "Khan").verdict).toBe("OK");
  });
  it("OK when only first name is set and matches", () => {
    expect(compareNames("Amina Whatever", "Amina", null).verdict).toBe("OK");
  });
});

describe("compareNames — whole-word matching", () => {
  it("Ali does NOT match Alison (not a substring match)", () => {
    // expected "Ali" — doc has "Alison" — whole-word fail
    expect(compareNames("Alison Khan", "Ali", "Khan").verdict).toBe("FAIL");
  });
  it("Ali matches Ali exactly", () => {
    expect(compareNames("Ali Khan", "Ali", "Khan").verdict).toBe("OK");
  });
  it("Sam does NOT match Samuel", () => {
    expect(compareNames("Samuel Smith", "Sam", "Smith").verdict).toBe("FAIL");
  });
});

describe("compareNames — spelling variants", () => {
  it("Mohammed vs expected Muhammad → UNCLEAR", () => {
    const r = compareNames("Mohammed Khan", "Muhammad", "Khan");
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("please confirm");
  });
  it("Catherine vs expected Katherine → UNCLEAR", () => {
    expect(compareNames("Catherine Smith", "Katherine", "Smith").verdict).toBe("UNCLEAR");
  });
  it("Mohamed vs expected Muhammad → UNCLEAR (any variant pair)", () => {
    expect(compareNames("Mohamed Ali", "Muhammad", "Ali").verdict).toBe("UNCLEAR");
  });
});

describe("compareNames — extra/missing middle names", () => {
  it("extra middle name → UNCLEAR", () => {
    // doc has "Amina Ali Khan", expected has "Amina Khan" → "Ali" is an extra part
    const r = compareNames("Amina Ali Khan", "Amina", "Khan");
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("please confirm");
  });
  it("missing expected middle part → FAIL (it's an expected part that's absent)", () => {
    // expected is "Amina Ali" (first="Amina Ali"?), doc has "Amina Khan"
    // Actually our API is firstName/lastName. Let's test: expected first="Amina" last="Khan",
    // doc="Amina" — missing last name
    expect(compareNames("Amina", "Amina", "Khan").verdict).toBe("FAIL");
  });
  it("document with only last name when first also expected → FAIL", () => {
    expect(compareNames("Khan", "Amina", "Khan").verdict).toBe("FAIL");
  });
});

describe("compareNames — no expected name", () => {
  it("UNCLEAR when both first and last are null", () => {
    expect(compareNames("John Smith", null, null).verdict).toBe("UNCLEAR");
  });
  it("detail says expected name not set", () => {
    expect(compareNames("John Smith", null, null).detail).toContain("not set");
  });
});

describe("compareNames — FAIL cases", () => {
  it("completely wrong last name → FAIL", () => {
    expect(compareNames("Amina Smith", "Amina", "Khan").verdict).toBe("FAIL");
  });
  it("completely wrong first name → FAIL", () => {
    expect(compareNames("John Khan", "Amina", "Khan").verdict).toBe("FAIL");
  });
});

describe("compareNames — sponsor document scenario", () => {
  it("sponsor name used for SPONSOR files: James Smith matches sponsor", () => {
    expect(compareNames("James Smith", "James", "Smith").verdict).toBe("OK");
  });
  it("client name used for CLIENT files: Amina Khan mismatch with sponsor", () => {
    // If the doc says "James Smith" but we compare against client "Amina Khan" → FAIL
    expect(compareNames("James Smith", "Amina", "Khan").verdict).toBe("FAIL");
  });
});

describe("crossDocNameConsistency", () => {
  it("single entry — no cross-check needed, verdict OK", () => {
    const r = crossDocNameConsistency([{ value: "Amina Khan", docTitle: "Passport" }]);
    expect(r.verdict).toBe("OK");
  });

  it("two identical names → OK", () => {
    const entries = [
      { value: "Amina Khan", docTitle: "Passport" },
      { value: "Amina Khan", docTitle: "Bank statement" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("OK");
  });

  it("variant spelling across docs → UNCLEAR", () => {
    const entries = [
      { value: "Muhammad Khan", docTitle: "Passport" },
      { value: "Mohammed Khan", docTitle: "Payslip" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("UNCLEAR");
  });

  it("extra middle name in one doc → UNCLEAR", () => {
    const entries = [
      { value: "Amina Khan", docTitle: "Passport" },
      { value: "Amina Begum Khan", docTitle: "Bank statement" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("UNCLEAR");
  });

  it("conflicting last name across docs → FAIL", () => {
    const entries = [
      { value: "Amina Khan", docTitle: "Passport" },
      { value: "Amina Smith", docTitle: "Bank statement" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("FAIL");
  });

  it("three docs — two consistent, one conflict → FAIL", () => {
    const entries = [
      { value: "John Smith", docTitle: "Passport" },
      { value: "John Smith", docTitle: "Payslip" },
      { value: "John Jones", docTitle: "Bank statement" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("FAIL");
  });
});
