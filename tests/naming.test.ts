import { describe, expect, it } from "vitest";
import { caseFolder, normaliseMobile, storedFileName } from "../lib/naming";
import { cleanSegment } from "../lib/adapters/storage";

describe("normaliseMobile", () => {
  it.each([
    ["07700 900121", "+447700900121"],
    ["+44 7700 900121", "+447700900121"],
    ["0044 7700-900121", "+447700900121"],
    ["447700900121", "+447700900121"],
  ])("%s → %s", (input, out) => expect(normaliseMobile(input)).toBe(out));
  it("rejects junk", () => expect(normaliseMobile("hello")).toBeNull());
});

describe("file and folder names", () => {
  it("follows {Surname}_{DocumentType}_{YYYY-MM-DD}.pdf with _2, _3 for extras", () => {
    expect(storedFileName("Khan", "Passport", 1, "2026-10-09")).toBe("Khan_Passport_2026-10-09.pdf");
    expect(storedFileName("Khan", "Payslip", 3, "2026-10-12")).toBe("Khan_Payslip_3_2026-10-12.pdf");
    expect(storedFileName("De la Cruz", "Payslip", 1, "2026-10-12")).toBe("De-la-Cruz_Payslip_2026-10-12.pdf");
  });
  it("builds Clients/{Surname}_{Firstname}_{CaseRef}", () => {
    expect(caseFolder({ firstName: "Amina", lastName: "Khan", caseRef: "IM-2041" })).toEqual(["Clients", "Khan_Amina_IM-2041"]);
  });
  it("strips characters OneDrive rejects and path tricks", () => {
    expect(cleanSegment('a/b\\c:*?"<>|d')).toBe("abcd");
    expect(() => cleanSegment("..")).toThrow();
  });
});
