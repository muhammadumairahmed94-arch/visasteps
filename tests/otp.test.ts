import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-auth-secret-must-be-32-chars!!!";
});

describe("validateOtpCode", () => {
  async function setup() {
    const { hmac } = await import("../lib/crypto");
    const { validateOtpCode } = await import("../lib/accounts");

    const GOOD = "123456";
    const BAD = "000000";
    const codeHash = hmac(GOOD);
    const future = new Date(Date.now() + 10 * 60 * 1000);
    const past = new Date(Date.now() - 1);

    function rec(overrides: Partial<{ expiresAt: Date; usedAt: Date | null; attempts: number }> = {}) {
      return { id: "r1", codeHash, expiresAt: future, usedAt: null, attempts: 0, ...overrides };
    }

    return { validateOtpCode, GOOD, BAD, rec, past };
  }

  it("accepts a correct code before expiry", async () => {
    const { validateOtpCode, rec, GOOD } = await setup();
    expect(validateOtpCode(rec(), GOOD)).toEqual({ ok: true });
  });

  it("rejects a wrong code; does not cancel on the first try", async () => {
    const { validateOtpCode, rec, BAD } = await setup();
    const r = validateOtpCode(rec(), BAD);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cancel).toBe(false);
      expect(r.countFail).toBe(true);
    }
  });

  it("rejects an expired code; does not count as a failure", async () => {
    const { validateOtpCode, rec, GOOD, past } = await setup();
    const r = validateOtpCode(rec({ expiresAt: past }), GOOD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countFail).toBe(false);
  });

  it("rejects a used code (usedAt set); does not count as a failure", async () => {
    const { validateOtpCode, rec, GOOD } = await setup();
    const r = validateOtpCode(rec({ usedAt: new Date() }), GOOD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countFail).toBe(false);
  });

  it("rejects immediately when attempts already at maximum; does not re-count", async () => {
    const { validateOtpCode, rec, BAD } = await setup();
    const r = validateOtpCode(rec({ attempts: 5 }), BAD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.countFail).toBe(false);
  });

  it("cancels the code on the 5th wrong try", async () => {
    const { validateOtpCode, rec, BAD } = await setup();
    const r = validateOtpCode(rec({ attempts: 4 }), BAD);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cancel).toBe(true);
      expect(r.countFail).toBe(true);
    }
  });

  it("does NOT cancel on the 4th wrong try", async () => {
    const { validateOtpCode, rec, BAD } = await setup();
    const r = validateOtpCode(rec({ attempts: 3 }), BAD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cancel).toBe(false);
  });

  it("accepts a correct code after 3 wrong tries (below limit)", async () => {
    const { validateOtpCode, rec, GOOD } = await setup();
    expect(validateOtpCode(rec({ attempts: 3 }), GOOD)).toEqual({ ok: true });
  });
});
