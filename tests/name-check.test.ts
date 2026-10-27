import { describe, it, expect } from "vitest";
import { compareNames, crossDocNameConsistency, areVariants, splitNameParts, normaliseName } from "@/lib/name-check";

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

describe("normaliseName", () => {
  it("lowercases", () => {
    expect(normaliseName("AMINA KHAN")).toBe("amina khan");
  });

  it("removes accents — Müller → muller", () => {
    expect(normaliseName("Müller")).toBe("muller");
  });

  it("removes accents — résumé → resume", () => {
    expect(normaliseName("résumé")).toBe("resume");
  });

  it("replaces hyphens with spaces — Anne-Marie → anne marie", () => {
    expect(normaliseName("Anne-Marie")).toBe("anne marie");
  });

  it("replaces apostrophes with spaces — O'Brien → o brien", () => {
    expect(normaliseName("O'Brien")).toBe("o brien");
  });

  it("removes commas — Khan, Amina → amina khan (reordered)", () => {
    expect(normaliseName("Khan, Amina")).toBe("amina khan");
  });

  it("removes full stops — Dr. John → dr john", () => {
    expect(normaliseName("Dr. John")).toBe("dr john");
  });

  it("handles MRZ order — KHAN<<AMINA → amina khan", () => {
    expect(normaliseName("KHAN<<AMINA")).toBe("amina khan");
  });

  it("handles MRZ with single < within name — O<BRIEN<<JOHN → john o brien", () => {
    expect(normaliseName("O<BRIEN<<JOHN")).toBe("john o brien");
  });

  it("collapses extra whitespace", () => {
    expect(normaliseName("  John   Smith  ")).toBe("john smith");
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

describe("compareNames — normalisation", () => {
  it("SURNAME, GIVEN format — 'Khan, Amina' matches 'Amina' + 'Khan'", () => {
    expect(compareNames("Khan, Amina", "Amina", "Khan").verdict).toBe("OK");
  });

  it("MRZ order — 'KHAN<<AMINA' matches 'Amina' + 'Khan'", () => {
    expect(compareNames("KHAN<<AMINA", "Amina", "Khan").verdict).toBe("OK");
  });

  it("hyphen — 'Anne-Marie Smith' matches 'Anne Marie' + 'Smith'", () => {
    expect(compareNames("Anne-Marie Smith", "Anne Marie", "Smith").verdict).toBe("OK");
  });

  it("apostrophe — 'O'Brien' matches 'O'Brien'", () => {
    expect(compareNames("O'Brien", "O'Brien", null).verdict).toBe("OK");
  });

  it("accent — 'Müller' matches 'Muller'", () => {
    expect(compareNames("Müller", "Muller", null).verdict).toBe("OK");
  });

  it("full stop — 'Dr. John Smith' vs 'John' + 'Smith' is UNCLEAR (Dr is extra)", () => {
    expect(compareNames("Dr. John Smith", "John", "Smith").verdict).toBe("UNCLEAR");
  });
});

describe("compareNames — whole-word matching", () => {
  it("'Alison Khan' vs 'Ali' + 'Khan': Khan matches, Ali does not → UNCLEAR", () => {
    // 'Ali' and 'Alison' are different words; but 'Khan' does match → partial match
    expect(compareNames("Alison Khan", "Ali", "Khan").verdict).toBe("UNCLEAR");
  });
  it("Ali matches Ali exactly", () => {
    expect(compareNames("Ali Khan", "Ali", "Khan").verdict).toBe("OK");
  });
  it("'Samuel Smith' vs 'Sam' + 'Smith': Smith matches, Sam does not → UNCLEAR", () => {
    expect(compareNames("Samuel Smith", "Sam", "Smith").verdict).toBe("UNCLEAR");
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
    const r = compareNames("Amina Ali Khan", "Amina", "Khan");
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.detail).toContain("please confirm");
  });
  it("missing last name — 'Amina' vs 'Amina' + 'Khan' → UNCLEAR (Amina matches, Khan missing)", () => {
    expect(compareNames("Amina", "Amina", "Khan").verdict).toBe("UNCLEAR");
  });
  it("only last name in doc vs both expected → UNCLEAR (Khan matches, Amina missing)", () => {
    expect(compareNames("Khan", "Amina", "Khan").verdict).toBe("UNCLEAR");
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

describe("compareNames — FAIL (no part matches at all)", () => {
  it("completely different name → FAIL", () => {
    expect(compareNames("James Jones", "Amina", "Khan").verdict).toBe("FAIL");
  });
  it("different surname and first name, no overlap → FAIL", () => {
    expect(compareNames("Robert Brown", "Amina", "Khan").verdict).toBe("FAIL");
  });
});

describe("compareNames — partial match is UNCLEAR not FAIL", () => {
  it("different surname but first name matches → UNCLEAR (possible maiden name)", () => {
    expect(compareNames("Amina Smith", "Amina", "Khan").verdict).toBe("UNCLEAR");
  });
  it("different first name but surname matches → UNCLEAR", () => {
    expect(compareNames("John Khan", "Amina", "Khan").verdict).toBe("UNCLEAR");
  });
});

describe("compareNames — sponsor document scenario", () => {
  it("sponsor name used for SPONSOR files: James Smith matches sponsor", () => {
    expect(compareNames("James Smith", "James", "Smith").verdict).toBe("OK");
  });
  it("client name used for CLIENT files: James Smith vs Amina Khan → FAIL (no part matches)", () => {
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

  it("normalised names match across docs — 'KHAN<<AMINA' and 'Amina Khan' → OK", () => {
    const entries = [
      { value: "KHAN<<AMINA", docTitle: "Passport MRZ" },
      { value: "Amina Khan", docTitle: "Bank statement" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("OK");
  });

  it("hyphenated and plain version are consistent — 'Anne-Marie Smith' and 'Anne Marie Smith' → OK", () => {
    const entries = [
      { value: "Anne-Marie Smith", docTitle: "Passport" },
      { value: "Anne Marie Smith", docTitle: "Payslip" },
    ];
    expect(crossDocNameConsistency(entries).verdict).toBe("OK");
  });
});
