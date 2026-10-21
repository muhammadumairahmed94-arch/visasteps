import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import type { User } from "@prisma/client";
import { db } from "./db";
import { decrypt, encrypt, hmac, randomToken } from "./crypto";

const PURPOSE = "totp";
const totp = (secretBase32: string, label = "", issuer = "UHA Legal") =>
  new TOTP({ issuer, label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secretBase32) });

/** Starts (or resumes) setup: returns the QR code and the key for typing in by hand. */
export async function beginEnrolment(user: User, issuer: string) {
  let secret = user.totpSecret && !user.totpEnabledAt ? decrypt(user.totpSecret, PURPOSE) : null;
  if (!secret) {
    secret = new Secret({ size: 20 }).base32;
    await db.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret, PURPOSE), totpEnabledAt: null, totpLastStep: null } });
  }
  const uri = totp(secret, user.email, issuer).toString();
  return { qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, color: { dark: "#262626", light: "#ffffff" } }), secret: secret.replace(/(.{4})/g, "$1 ").trim() };
}

/**
 * Checks a 6-digit code (±30 seconds for phone clock drift). A code is accepted once only.
 * Returns the time step on success so it can be stored.
 */
export function checkCode(user: User, code: string): number | null {
  if (!user.totpSecret || !/^\d{6}$/.test(code)) return null;
  const t = totp(decrypt(user.totpSecret, PURPOSE));
  const delta = t.validate({ token: code, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (user.totpLastStep !== null && step <= user.totpLastStep) return null; // replayed
  return step;
}

const hashRecovery = (code: string) => hmac(`recovery:${code.replace(/[^a-z0-9]/gi, "").toLowerCase()}`);

/** Eight single-use codes for when the phone is lost. Only hashes are stored. */
export function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const raw = randomToken().replace(/[^a-z0-9]/gi, "").slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

/** Returns the remaining hashes if the code matched, or null. */
export function useRecoveryCode(user: User, code: string): string[] | null {
  const h = hashRecovery(code);
  return user.recoveryCodes.includes(h) ? user.recoveryCodes.filter((x) => x !== h) : null;
}
