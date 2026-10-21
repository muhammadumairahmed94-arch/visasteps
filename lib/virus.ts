import { Socket } from "node:net";

/**
 * Virus scanning with ClamAV (clamd) over its INSTREAM protocol, so files never touch the disk.
 *   VIRUS_SCAN="clamav"  scan every upload; if the scanner is unreachable, uploads are refused (fail closed)
 *   VIRUS_SCAN="off"     no scanning (local development / tests only)
 */

export type ScanResult = { clean: true } | { clean: false; virus: string };

export class ScannerUnavailable extends Error {}

const CHUNK = 64 * 1024;

export function scanningEnabled() {
  return (process.env.VIRUS_SCAN ?? "off") === "clamav";
}

export function scan(data: Buffer, opts = { host: process.env.CLAMAV_HOST ?? "127.0.0.1", port: Number(process.env.CLAMAV_PORT ?? 3310), timeoutMs: 60_000 }): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let reply = "";
    const fail = (why: string) => {
      socket.destroy();
      reject(new ScannerUnavailable(`Virus scanner unavailable: ${why}`));
    };
    socket.setTimeout(opts.timeoutMs, () => fail("timed out"));
    socket.on("error", (e) => fail(e.message));
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => {
      const text = reply.replace(/\0/g, "").trim(); // e.g. "stream: OK" or "stream: Eicar-Test-Signature FOUND"
      if (/: OK$/.test(text)) return resolve({ clean: true });
      const found = text.match(/: (.+) FOUND$/);
      if (found) return resolve({ clean: false, virus: found[1] });
      fail(`unexpected reply "${text.slice(0, 120)}"`);
    });
    socket.connect(opts.port, opts.host, () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero length = end of stream
    });
  });
}

/** Health check: does clamd answer PING with PONG? */
export function ping(host = process.env.CLAMAV_HOST ?? "127.0.0.1", port = Number(process.env.CLAMAV_PORT ?? 3310)): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let reply = "";
    socket.setTimeout(3000, () => (socket.destroy(), resolve(false)));
    socket.on("error", () => resolve(false));
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => resolve(reply.includes("PONG")));
    socket.connect(port, host, () => socket.write("zPING\0"));
  });
}
