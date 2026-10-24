import { db } from "./db";
import { requestIp } from "./auth";
import { UserError } from "./errors";

const MIN = 60 * 1000;

/** Named limits: max requests per window. */
export const LIMITS = {
  clientLogin: { max: 20, window: 15 * MIN },   // per IP (each account also locks after 10 wrong passwords)
  forgotIp: { max: 10, window: 60 * MIN },      // per IP
  forgotEmail: { max: 3, window: 60 * MIN },    // per email address
  link: { max: 30, window: 15 * MIN },          // opening / using emailed links, per IP
  staffLogin: { max: 30, window: 15 * MIN },    // per IP (an office may share one); each account also locks after 10 misses
  upload: { max: 60, window: 60 * MIN },        // per client
  reportMissing: { max: 10, window: 60 * MIN }, // per client
  createClient: { max: 50, window: 60 * MIN },  // per caseworker
  otpRequest:      { max: 5,  window: 60 * MIN },   // per IP: requesting an OTP code
  otpRequestEmail: { max: 3,  window: 60 * MIN },   // per email: prevents inbox flooding
  otpVerify:       { max: 10, window: 15 * MIN },   // per IP: verifying a code
} as const;

export type LimitName = keyof typeof LIMITS;

/** Counts one hit against `name:id`. Returns false when over the limit. One atomic statement, safe across servers. */
export async function hit(name: LimitName, id: string): Promise<boolean> {
  const { max, window } = LIMITS[name];
  const key = `${name}:${id}`;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, NOW() + ${window} * INTERVAL '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" < NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < NOW() THEN NOW() + ${window} * INTERVAL '1 millisecond' ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  return rows[0].count <= max;
}

export const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/** Throws a friendly 429-style error when over the limit. Keyed by IP unless an id is given. */
export async function limit(name: LimitName, id?: string) {
  const who = id ?? (await requestIp()) ?? "unknown";
  if (!(await hit(name, who))) throw new RateLimited();
}

export class RateLimited extends UserError {
  constructor() {
    super(TOO_MANY);
  }
}

/** Housekeeping: drop expired counters (called opportunistically). */
export async function sweep() {
  await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } });
}
