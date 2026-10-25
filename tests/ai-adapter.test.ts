import { describe, it, expect, afterEach } from "vitest";

const orig = process.env.AI_PROVIDER;
afterEach(() => { process.env.AI_PROVIDER = orig; });

describe("ai adapter — off", () => {
  it("throws when AI_PROVIDER is off", async () => {
    process.env.AI_PROVIDER = "off";
    const { ai } = await import("@/lib/adapters/ai");
    await expect(ai().analyse({ text: "hello", docTitle: "Passport" })).rejects.toThrow();
  });
});

describe("ai adapter — fake", () => {
  it("returns a summary and empty flags for normal text", async () => {
    process.env.AI_PROVIDER = "fake";
    const { ai } = await import("@/lib/adapters/ai");
    const result = await ai().analyse({ text: "John Smith, DOB 01/01/1990, passport number AB123456", docTitle: "Passport" });
    expect(result).toMatchObject({ summary: expect.any(String), flags: expect.any(Array) });
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.flags).toHaveLength(0);
  });

  it("flags expired text", async () => {
    process.env.AI_PROVIDER = "fake";
    const { ai } = await import("@/lib/adapters/ai");
    const result = await ai().analyse({ text: "This passport has expired on 01/01/2020", docTitle: "Passport" });
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it("includes the docTitle in the summary", async () => {
    process.env.AI_PROVIDER = "fake";
    const { ai } = await import("@/lib/adapters/ai");
    const result = await ai().analyse({ text: "Monthly salary statement from HSBC", docTitle: "Bank statement" });
    expect(result.summary).toContain("Bank statement");
  });
});

describe("ai adapter — unknown provider", () => {
  it("throws on unknown AI_PROVIDER", async () => {
    process.env.AI_PROVIDER = "openai";
    const { ai } = await import("@/lib/adapters/ai");
    expect(() => ai()).toThrow(/unknown/i);
  });
});
