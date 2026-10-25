import { describe, it, expect } from "vitest";
import { resolvedOwner, visibleFiles } from "@/lib/sponsor";

const doc = (override: string | null, routeDefault: string) => ({
  assignedToOverride: override,
  checklistItem: { assignedTo: routeDefault },
});

describe("resolvedOwner", () => {
  it("returns route default when no override", () => {
    expect(resolvedOwner(doc(null, "CLIENT"), true)).toBe("CLIENT");
    expect(resolvedOwner(doc(null, "SPONSOR"), true)).toBe("SPONSOR");
  });

  it("override takes precedence over route default", () => {
    expect(resolvedOwner(doc("SPONSOR", "CLIENT"), true)).toBe("SPONSOR");
    expect(resolvedOwner(doc("CLIENT", "SPONSOR"), true)).toBe("CLIENT");
  });

  it("falls back to CLIENT when SPONSOR-assigned but no sponsor active", () => {
    expect(resolvedOwner(doc(null, "SPONSOR"), false)).toBe("CLIENT");
    expect(resolvedOwner(doc("SPONSOR", "CLIENT"), false)).toBe("CLIENT");
  });

  it("stays CLIENT when CLIENT-assigned regardless of sponsor active", () => {
    expect(resolvedOwner(doc(null, "CLIENT"), false)).toBe("CLIENT");
    expect(resolvedOwner(doc("CLIENT", "SPONSOR"), false)).toBe("CLIENT");
  });
});

const file = (kind: string, supersededAt: Date | null = null) => ({ uploaderKind: kind, supersededAt });

describe("visibleFiles", () => {
  const files = [
    file("CLIENT"),
    file("SPONSOR"),
    file("CLIENT", new Date()), // superseded
  ];

  it("client without filesShared sees only CLIENT active files", () => {
    const result = visibleFiles(files, "CLIENT", false);
    expect(result).toHaveLength(1);
    expect(result[0].uploaderKind).toBe("CLIENT");
  });

  it("sponsor without filesShared sees only SPONSOR active files", () => {
    const result = visibleFiles(files, "SPONSOR", false);
    expect(result).toHaveLength(1);
    expect(result[0].uploaderKind).toBe("SPONSOR");
  });

  it("with filesShared both parties see all active files", () => {
    const result = visibleFiles(files, "CLIENT", true);
    expect(result).toHaveLength(2);
  });

  it("superseded files are always excluded", () => {
    const allClient = [file("CLIENT"), file("CLIENT", new Date())];
    expect(visibleFiles(allClient, "CLIENT", false)).toHaveLength(1);
    expect(visibleFiles(allClient, "CLIENT", true)).toHaveLength(1);
  });
});
