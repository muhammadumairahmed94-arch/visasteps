import type { User } from "@prisma/client";
import { db } from "./db";

const MAX_FAILS = 10;
const LOCK = 15 * 60 * 1000;
export const LOCKED = "Too many attempts. This account is locked for 15 minutes.";

export const isLocked = (u: User) => !!u.lockedUntil && u.lockedUntil > new Date();

/** Wrong password or wrong code. Returns true if the account is now locked. */
export async function recordFailure(u: User): Promise<boolean> {
  const fails = u.failedLogins + 1;
  const lock = fails >= MAX_FAILS;
  await db.user.update({
    where: { id: u.id },
    data: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK) } : { failedLogins: fails },
  });
  return lock;
}

export const clearFailures = (u: User) => db.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null } });
