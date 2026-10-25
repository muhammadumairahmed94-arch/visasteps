import bcrypt from "bcryptjs";
import type { Client, Firm, LinkKind } from "@prisma/client";
import { db } from "./db";
import { hmac, randomToken, safeEqual, sha256, sixDigitCode } from "./crypto";
import { sendSafely, email as emailAdapter } from "./adapters/email";

const HOUR = 60 * 60 * 1000;
const LINK_TTL: Record<LinkKind, number> = { SETUP: 7 * 24 * HOUR, RESET: HOUR, STAFF: 7 * 24 * HOUR };
const MAX_FAILS = 10;
const LOCK = 15 * 60 * 1000;

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Kept deliberately simple for clients: length only, no symbol rules. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Please use at least 8 characters.";
  if (pw.length > 200) return "That password is too long.";
  return null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);

/** A fresh single-use link. Older unused links of the same kind stop working. */
export async function createLink(clientId: string, kind: LinkKind): Promise<string> {
  const token = randomToken();
  await db.invite.updateMany({ where: { clientId, kind, usedAt: null }, data: { usedAt: new Date() } });
  await db.invite.create({ data: { clientId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_TTL[kind]) } });
  return `${appUrl()}/i/${token}`;
}

/** Returns a client link (create account / reset password) if unused and in date. A setup link stops once the account exists. */
export async function findLink(token: unknown) {
  if (typeof token !== "string" || !token) return null;
  const link = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { client: { include: { firm: true } } } });
  if (!link || !link.client || link.client.closedAt || link.kind === "STAFF" || link.usedAt || link.expiresAt < new Date()) return null;
  if (link.kind === "SETUP" && link.client.accountCreatedAt) return null;
  return { ...link, client: link.client };
}

/** New caseworker: a single-use "set your password" link (7 days). Older unused ones stop working. */
export async function createStaffLink(userId: string): Promise<string> {
  const token = randomToken();
  await db.invite.updateMany({ where: { userId, kind: "STAFF", usedAt: null }, data: { usedAt: new Date() } });
  await db.invite.create({ data: { userId, kind: "STAFF", tokenHash: sha256(token), expiresAt: new Date(Date.now() + LINK_TTL.STAFF) } });
  return `${appUrl()}/staff/setup/${token}`;
}

export async function findStaffLink(token: unknown) {
  if (typeof token !== "string" || !token) return null;
  const link = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { firm: true } } } });
  if (!link || !link.user || link.kind !== "STAFF" || link.usedAt || link.expiresAt < new Date() || link.user.disabledAt) return null;
  return { ...link, user: link.user };
}

export async function sendStaffLink(user: { id: string; name: string; email: string }, firm: Firm): Promise<boolean> {
  const link = await createStaffLink(user.id);
  return sendSafely({
    to: user.email,
    brand: firm.name,
    subject: `${firm.name}: your caseworker account`,
    text: `Hello ${user.name},\n\nA caseworker account has been created for you on the ${firm.name} client portal. Choose a password to get started. You will then set up two-step sign-in with an authenticator app.\n\nThis link is valid for 7 days and can be used once.`,
    action: { label: "Set your password", url: link },
  });
}

/** Returns false if the email could not be sent. */
export async function sendSetupLink(client: Client, firm: Firm): Promise<boolean> {
  const link = await createLink(client.id, "SETUP");
  return sendSafely({
    to: client.email,
    brand: firm.name,
    subject: `${firm.name}: client portal invitation`,
    text: `${firm.name} has invited you to its secure client portal to upload visa documents.\n\nThis link is valid for 7 days and can be used once.`,
    action: { label: "Create account", url: link },
  });
}

export async function sendSponsorInvite(
  sponsorClient: Client,
  parentClient: { firstName: string | null; lastName: string | null; email: string },
  firm: Firm,
): Promise<boolean> {
  const link = await createLink(sponsorClient.id, "SETUP");
  const name =
    parentClient.firstName && parentClient.lastName
      ? `${parentClient.firstName} ${parentClient.lastName}`
      : parentClient.email;
  return sendSafely({
    to: sponsorClient.email,
    brand: firm.name,
    subject: `${firm.name}: invitation to upload your documents`,
    text: `${firm.name} has asked you to upload some documents to help with ${name}'s UK visa application.\n\nThis link is valid for 7 days and can be used once.`,
    action: { label: "Create account", url: link },
  });
}

export async function sendResetLink(client: Client, firm: Firm): Promise<boolean> {
  const link = await createLink(client.id, "RESET");
  return sendSafely({
    to: client.email,
    brand: firm.name,
    subject: `${firm.name}: password reset`,
    text: `A password reset was requested for the ${firm.name} client portal.\n\nThis link is valid for 1 hour. If this was not requested, no action is needed.`,
    action: { label: "Choose a new password", url: link },
  });
}

export type LoginResult = { ok: true; client: Client } | { ok: false; message: string; client?: Client };

// ---------------------------------------------------------------------------
// OTP sign-in
// ---------------------------------------------------------------------------

const OTP_TTL = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

export type OtpCodeRecord = {
  id: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
};

/**
 * Pure function — no DB access. Returns { ok: true } or a failure descriptor.
 * `cancel` is true when this wrong attempt is the last allowed before the code is retired.
 * `countFail` is true when this attempt should increment the shared failedLogins counter.
 */
export function validateOtpCode(
  rec: OtpCodeRecord,
  inputCode: string,
): { ok: true } | { ok: false; message: string; cancel: boolean; countFail: boolean } {
  if (rec.usedAt)
    return { ok: false, message: "That code has already been used. Please request a new one.", cancel: false, countFail: false };
  if (rec.expiresAt < new Date())
    return { ok: false, message: "That code has expired. Please request a new one.", cancel: false, countFail: false };
  if (rec.attempts >= OTP_MAX_ATTEMPTS)
    return { ok: false, message: "Too many wrong tries. Please request a new code.", cancel: false, countFail: false };
  if (!safeEqual(hmac(inputCode), rec.codeHash)) {
    const cancel = rec.attempts + 1 >= OTP_MAX_ATTEMPTS;
    return {
      ok: false,
      message: cancel ? "Too many wrong tries. Please request a new code." : "That code is wrong.",
      cancel,
      countFail: true,
    };
  }
  return { ok: true };
}

/** Creates a new code for the client, cancelling any previous unused one. Returns the plaintext code (never stored). */
export async function createSignInCode(clientId: string): Promise<string> {
  const code = sixDigitCode();
  await db.signInCode.updateMany({ where: { clientId, usedAt: null }, data: { usedAt: new Date() } });
  await db.signInCode.create({ data: { clientId, codeHash: hmac(code), expiresAt: new Date(Date.now() + OTP_TTL) } });
  return code;
}

/** Sends the OTP email without logging the recipient or code on failure. */
export async function sendOtpEmail(code: string, client: Client, firm: Firm): Promise<void> {
  try {
    await emailAdapter().send({
      to: client.email,
      brand: firm.name,
      subject: `${firm.name}: your sign-in code`,
      text: `Your sign-in code is: ${code}\n\nIt is valid for 10 minutes and can only be used once.\n\nIf you did not request this code, you can ignore this message.`,
    });
  } catch (e) {
    console.error("OTP code delivery failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Verifies an OTP code and returns the client on success.
 * Wrong codes share the same failedLogins / lockedUntil counter as password sign-in.
 */
export async function redeemOtpCode(emailAddress: string, inputCode: string): Promise<LoginResult> {
  const client = await db.client.findUnique({
    where: { email: emailAddress.trim().toLowerCase() },
    include: { firm: true },
  });
  const wrong = { ok: false as const, message: "That code is wrong or has expired. Please request a new one." };
  if (!client) return wrong;
  if (client.closedAt) return { ok: false, message: "This case is closed. Please contact us if you need access." };
  if (client.lockedUntil && client.lockedUntil > new Date())
    return { ok: false, message: `Too many attempts. Please wait 15 minutes, or use "Forgot password?".`, client };

  const signInCode = await db.signInCode.findFirst({
    where: { clientId: client.id, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!signInCode) return { ...wrong, client };

  const result = validateOtpCode(signInCode, inputCode);

  if (!result.ok) {
    if (result.countFail) {
      // Atomically increment — only while the code is still unused and below the limit.
      const { count } = await db.signInCode.updateMany({
        where: { id: signInCode.id, usedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      if (count > 0) {
        // 5th wrong try: retire the code so it cannot be tried again.
        if (result.cancel) {
          await db.signInCode.updateMany({ where: { id: signInCode.id, usedAt: null }, data: { usedAt: new Date() } });
        }
        // Shared lockout — same counter as wrong passwords.
        const fails = client.failedLogins + 1;
        await db.client.update({
          where: { id: client.id },
          data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK) } : { failedLogins: fails },
        });
      }
    }
    return { ok: false, message: result.message, client };
  }

  // Atomically retire the code — only sign in if exactly one row was updated.
  // A concurrent request that already used the same code will see count=0.
  const now = new Date();
  const { count } = await db.signInCode.updateMany({
    where: { id: signInCode.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return { ...wrong, client };

  if (client.failedLogins) {
    await db.client.update({ where: { id: client.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  return { ok: true, client };
}

export async function checkLogin(emailAddress: string, password: string): Promise<LoginResult> {
  const client = await db.client.findUnique({ where: { email: emailAddress.trim().toLowerCase() } });
  const wrong = { ok: false as const, message: "Email or password is wrong." };
  if (!client?.passwordHash) {
    await bcrypt.compare(password, "$2b$12$7MLSQczEshzgUiOAFsCs.eY1ObwV/71CpG4KrSOFM69hpntfgZ63q"); // same timing either way
    return wrong;
  }
  if (client.closedAt) return { ok: false, message: "This case is closed. Please contact us if you need access." };
  if (client.lockedUntil && client.lockedUntil > new Date())
    return { ok: false, message: "Too many attempts. Please wait 15 minutes, or use “Forgot password?”." };
  if (await bcrypt.compare(password, client.passwordHash)) {
    if (client.failedLogins) await db.client.update({ where: { id: client.id }, data: { failedLogins: 0, lockedUntil: null } });
    return { ok: true, client };
  }
  const fails = client.failedLogins + 1;
  await db.client.update({
    where: { id: client.id },
    data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK) } : { failedLogins: fails },
  });
  return { ...wrong, client };
}
