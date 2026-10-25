import { cookies, headers } from "next/headers";
import type { SessionStage } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";

const DAY = 24 * 60 * 60 * 1000;
// Client sessions without "Keep me signed in": 12-hour window, session cookie (no Expires).
const SHORT_TTL = 12 * 60 * 60 * 1000;

const KINDS = {
  client: { cookie: "vs_client", ttl: 30 * DAY }, // 30-day sliding, same device
  staff: { cookie: "vs_staff", ttl: 12 * 60 * 60 * 1000 },
} as const;
type Kind = keyof typeof KINDS;

// Omitting expires produces a session cookie (browser drops it on close).
async function setCookie(kind: Kind, token: string, expires?: Date) {
  (await cookies()).set(KINDS[kind].cookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(expires !== undefined ? { expires } : {}),
  });
}

const MFA_TTL = 10 * 60 * 1000; // time allowed to enter the authenticator code

export async function startSession(
  kind: Kind,
  owner: { clientId: string } | { userId: string },
  stage: SessionStage = "FULL",
  options?: { remember?: boolean },
) {
  const remember = options?.remember !== false; // default true
  await endSession(kind); // never keep two sessions in one browser
  const token = randomToken();
  const ttl = stage === "MFA" ? MFA_TTL : remember ? KINDS[kind].ttl : SHORT_TTL;
  const expiresAt = new Date(Date.now() + ttl);
  await db.session.create({ data: { tokenHash: sha256(token), expiresAt, stage, ...owner } });
  // Session cookie (no Expires) when remember=false; persistent otherwise
  await setCookie(kind, token, stage === "MFA" || remember ? expiresAt : undefined);
}

async function current(kind: Kind, stage: SessionStage = "FULL") {
  const token = (await cookies()).get(KINDS[kind].cookie)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { client: true, user: true } });
  if (!s || s.expiresAt < new Date() || s.stage !== stage) return null;
  // Slide the expiry, at most once an hour per session.
  // Detect short sessions by comparing expiresAt to lastSeenAt: ~12 h for short, ~30 d for long.
  if (kind === "client" && Date.now() - s.lastSeenAt.getTime() > 60 * 60 * 1000) {
    const isShort = s.expiresAt.getTime() - s.lastSeenAt.getTime() < 2 * DAY;
    const ttl = isShort ? SHORT_TTL : KINDS[kind].ttl;
    const expiresAt = new Date(Date.now() + ttl);
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt } });
    // Short sessions are already session cookies — no need to re-set the cookie.
    if (!isShort) await setCookie(kind, token, expiresAt);
  }
  return s;
}

export async function currentClient() {
  const c = (await current("client"))?.client ?? null;
  return c && !c.closedAt ? c : null; // closed cases lose access at once
}

export async function currentStaff() {
  const u = (await current("staff"))?.user ?? null;
  return u && !u.disabledAt ? u : null; // removed staff lose access at once
}

/** Staff member who has given the right password but not yet the authenticator code. */
export async function pendingStaff() {
  const u = (await current("staff", "MFA"))?.user ?? null;
  return u && !u.disabledAt ? u : null;
}

export async function endSession(kind: Kind) {
  const jar = await cookies();
  const token = jar.get(KINDS[kind].cookie)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(KINDS[kind].cookie);
}

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip");
}

/** Signed-in staff member with the ADMIN role, or null. */
export async function currentAdmin() {
  const u = await currentStaff();
  return u?.role === "ADMIN" ? u : null;
}
