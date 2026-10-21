import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ characters)");
  return s;
}

/** Keyed hash so a leaked database alone cannot be used to brute-force short codes. */
export function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM with a key derived from AUTH_SECRET. Used for 2FA secrets, which must be readable to check codes. */
function key(purpose: string) {
  return createHash("sha256").update(`${secret()}:${purpose}`).digest();
}

export function encrypt(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(purpose), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(box: string, purpose: string): string {
  const [iv, tag, data] = box.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(purpose), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

/** Same as encrypt(), for file contents: iv(12) | tag(16) | data. */
export function encryptBuffer(data: Buffer, purpose: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(purpose), iv);
  const out = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]);
}

export function decryptBuffer(box: Buffer, purpose: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", key(purpose), box.subarray(0, 12));
  d.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([d.update(box.subarray(28)), d.final()]);
}
