import { describe, expect, it } from "vitest";
import { Socket } from "node:net";
import { ScannerUnavailable, scan } from "../lib/virus";

// The EICAR test file: harmless by design, flagged by every antivirus so scanners can be tested safely.
const EICAR = Buffer.from(String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`);

const clamdUp = await new Promise<boolean>((resolve) => {
  const s = new Socket().once("connect", () => (s.destroy(), resolve(true))).once("error", () => resolve(false));
  s.connect(3310, "127.0.0.1");
});

describe.skipIf(!clamdUp)("ClamAV scanning (needs clamd on 127.0.0.1:3310)", () => {
  it("passes a clean PDF", async () => {
    expect(await scan(Buffer.from("%PDF-1.7\n% clean demo document\n"))).toEqual({ clean: true });
  });
  it("flags the EICAR test file", async () => {
    const r = await scan(EICAR);
    expect(r.clean).toBe(false);
    if (!r.clean) expect(r.virus).toMatch(/eicar/i);
  });
});

describe("when the scanner is unreachable", () => {
  it("reports ScannerUnavailable so uploads are refused, not let through", async () => {
    await expect(scan(Buffer.from("x"), { host: "127.0.0.1", port: 1, timeoutMs: 2000 })).rejects.toBeInstanceOf(ScannerUnavailable);
  });
});
