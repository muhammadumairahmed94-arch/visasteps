import { describe, it, expect } from "vitest";
import { mrzCharValue, mrzCheckDigit, validateMrzLine2, extractMrzLines } from "@/lib/mrz";

describe("mrzCharValue", () => {
  it("digits 0–9 map to themselves", () => {
    for (let d = 0; d <= 9; d++) {
      expect(mrzCharValue(String(d))).toBe(d);
    }
  });
  it("A=10, B=11, Z=35", () => {
    expect(mrzCharValue("A")).toBe(10);
    expect(mrzCharValue("B")).toBe(11);
    expect(mrzCharValue("Z")).toBe(35);
  });
  it("< (filler) maps to 0", () => {
    expect(mrzCharValue("<")).toBe(0);
  });
});

describe("mrzCheckDigit", () => {
  // Test vectors from ICAO 9303 Part 3 sample
  it("field 'AB123456' → check digit 4", () => {
    // A=10,B=11,1=1,2=2,3=3,4=4,5=5,6=6 with weights 7,3,1,7,3,1,7,3
    // 10×7=70, 11×3=33, 1×1=1, 2×7=14, 3×3=9, 4×1=4, 5×7=35, 6×3=18
    // Sum=184, 184%10=4
    expect(mrzCheckDigit("AB123456")).toBe(4);
  });

  it("ICAO sample: field '740812' DOB → check digit 2", () => {
    // 7×7=49, 4×3=12, 0×1=0, 8×7=56, 1×3=3, 2×1=2 → sum=122, 122%10=2
    expect(mrzCheckDigit("740812")).toBe(2);
  });

  it("ICAO sample: field '120415' expiry → check digit 9", () => {
    // 1×7=7, 2×3=6, 0×1=0, 4×7=28, 1×3=3, 5×1=5 → sum=49, 49%10=9
    expect(mrzCheckDigit("120415")).toBe(9);
  });

  it("empty field → check digit 0", () => {
    expect(mrzCheckDigit("")).toBe(0);
  });

  it("all fillers → check digit 0", () => {
    expect(mrzCheckDigit("<<<<<<<<<")).toBe(0);
  });
});

describe("validateMrzLine2", () => {
  // Valid ICAO sample from doc 9303 Part 3 Annex D
  // Line 2: L898902C36UTO7408122F1204159ZE184226B<<<<<10
  const VALID_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

  it("validates the ICAO sample line correctly", () => {
    const r = validateMrzLine2(VALID_LINE2);
    expect(r.valid).toBe(true);
    expect(r.checks).toHaveLength(5);
    expect(r.checks.every((c) => c.valid)).toBe(true);
  });

  it("returns valid:false and empty checks for wrong length", () => {
    const r = validateMrzLine2("TOOSHORT");
    expect(r.valid).toBe(false);
    expect(r.checks).toHaveLength(0);
  });

  it("detects a corrupted passport number check digit", () => {
    // Change check digit at position 10 from '6' to '9'
    const bad = VALID_LINE2.slice(0, 9) + "9" + VALID_LINE2.slice(10);
    const r = validateMrzLine2(bad);
    expect(r.valid).toBe(false);
    const passportCheck = r.checks.find((c) => c.field === "Passport number");
    expect(passportCheck?.valid).toBe(false);
  });

  it("detects a corrupted DOB check digit", () => {
    // DOB check digit is position 20 (index 19), original '2'
    const bad = VALID_LINE2.slice(0, 19) + "5" + VALID_LINE2.slice(20);
    const r = validateMrzLine2(bad);
    expect(r.valid).toBe(false);
    const dobCheck = r.checks.find((c) => c.field === "Date of birth");
    expect(dobCheck?.valid).toBe(false);
  });

  it("detects a corrupted expiry date check digit", () => {
    // Expiry check digit is position 28 (index 27), original '9'
    const bad = VALID_LINE2.slice(0, 27) + "0" + VALID_LINE2.slice(28);
    const r = validateMrzLine2(bad);
    expect(r.valid).toBe(false);
    const expiryCheck = r.checks.find((c) => c.field === "Expiry date");
    expect(expiryCheck?.valid).toBe(false);
  });

  it("detects a corrupted composite check digit", () => {
    // Composite check digit is position 44 (index 43), original '0'
    const bad = VALID_LINE2.slice(0, 43) + "5";
    const r = validateMrzLine2(bad);
    expect(r.valid).toBe(false);
    const compositeCheck = r.checks.find((c) => c.field === "Composite");
    expect(compositeCheck?.valid).toBe(false);
  });
});

describe("extractMrzLines", () => {
  const LINE1 = "P<UTOSURNAME<<GIVENNAMES<<<<<<<<<<<<<<<<<<<<";
  const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

  it("extracts two consecutive MRZ lines from text", () => {
    const text = `Some intro text\n${LINE1}\n${LINE2}\nSome trailing text`;
    const result = extractMrzLines(text);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(LINE1);
    expect(result![1]).toBe(LINE2);
  });

  it("returns null when no MRZ lines are found", () => {
    expect(extractMrzLines("No MRZ here")).toBeNull();
    expect(extractMrzLines("Short line\nAlso short")).toBeNull();
  });

  it("returns null for a single MRZ line without a partner", () => {
    expect(extractMrzLines(`${LINE1}\nsome other text`)).toBeNull();
  });
});
