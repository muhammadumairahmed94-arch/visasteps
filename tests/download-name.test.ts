import { describe, expect, it } from "vitest";

// The same header the file route builds; Response headers must be Latin-1, so non-ASCII names need encoding
const header = (name: string) => `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

describe("download file names", () => {
  it("never break the response for non-English surnames", () => {
    for (const name of ["Khan_Passport_2026-10-18.pdf", "خان_Passport_2026-10-18.pdf", "Çelik_Payslip_2_2026-10-18.pdf", 'O"Brien.pdf']) {
      expect(() => new Response("x", { headers: { "Content-Disposition": header(name) } })).not.toThrow();
    }
    expect(header("Çelik.pdf")).toContain("filename*=UTF-8''%C3%87elik.pdf");
  });
});
