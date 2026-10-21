import bcrypt from "bcryptjs";
import type { Client, Firm, LinkKind } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { sendSafely } from "./adapters/email";

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
