import { describe, it, expect } from "vitest";
import { findNextDoc, STAGES } from "../lib/case-stage";

const doc = (id: string, status: string, required = true) => ({ id, status, required });

describe("findNextDoc", () => {
  it("returns null when all required docs are sent", () => {
    expect(findNextDoc([doc("a", "SENT"), doc("b", "OK")])).toBeNull();
  });

  it("returns null when only optional docs are left", () => {
    expect(findNextDoc([doc("a", "OK"), doc("b", "NEED", false)])).toBeNull();
  });

  it("returns the first required NEED doc when nothing is pending redo", () => {
    const docs = [doc("a", "OK"), doc("b", "NEED"), doc("c", "NEED")];
    expect(findNextDoc(docs)?.id).toBe("b");
  });

  it("returns a REDO doc before any NEED doc", () => {
    const docs = [doc("a", "NEED"), doc("b", "REDO"), doc("c", "NEED")];
    expect(findNextDoc(docs)?.id).toBe("b");
  });

  it("returns the first REDO when there are multiple", () => {
    const docs = [doc("a", "REDO"), doc("b", "REDO")];
    expect(findNextDoc(docs)?.id).toBe("a");
  });

  it("skips optional NEED docs in favour of required NEED docs", () => {
    const docs = [doc("a", "NEED", false), doc("b", "NEED", true)];
    expect(findNextDoc(docs)?.id).toBe("b");
  });

  it("returns null for an empty list", () => {
    expect(findNextDoc([])).toBeNull();
  });
});

describe("STAGES", () => {
  it("has exactly 5 stages", () => {
    expect(STAGES).toHaveLength(5);
  });

  it("starts with DOCUMENTS and ends with DECISION", () => {
    expect(STAGES[0].key).toBe("DOCUMENTS");
    expect(STAGES[4].key).toBe("DECISION");
  });

  it("is in the right order", () => {
    expect(STAGES.map((s) => s.key)).toEqual([
      "DOCUMENTS",
      "CHECKING",
      "READY",
      "SUBMITTED",
      "DECISION",
    ]);
  });

  it("every stage has a non-empty label and detail", () => {
    for (const s of STAGES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });
});
