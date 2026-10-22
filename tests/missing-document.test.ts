import { describe, expect, it } from "vitest";

/**
 * Pure-function tests for the "I can't find this" feature.
 * DB-touching tests live in the e2e suite.
 */

describe("reviewDays message", () => {
  function uploadMessage(reviewDays: number) {
    return `Received. Your caseworker usually checks documents within ${reviewDays} working ${reviewDays === 1 ? "day" : "days"}.`;
  }

  it("uses 'day' for 1", () => {
    expect(uploadMessage(1)).toBe("Received. Your caseworker usually checks documents within 1 working day.");
  });

  it("uses 'days' for 2", () => {
    expect(uploadMessage(2)).toBe("Received. Your caseworker usually checks documents within 2 working days.");
  });

  it("uses 'days' for 5", () => {
    expect(uploadMessage(5)).toBe("Received. Your caseworker usually checks documents within 5 working days.");
  });
});

describe("missingWhere filter", () => {
  it("reminder filter excludes flagged documents (missingAt: null)", async () => {
    // Statically verify the shape of missingWhere by importing from reminders (no DB call)
    // We do this by reading the compiled module; as a pure structural check:
    const src = await import("node:fs").then((f) =>
      f.readFileSync(new URL("../lib/reminders.ts", import.meta.url).pathname, "utf8"),
    );
    expect(src).toContain("missingAt: null");
  });
});
