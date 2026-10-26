import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { UserError, NotFoundError } from "./errors";
import { RateLimited } from "./ratelimit";
import { notifyOps } from "./alerts";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (message: string, status = 400) => json({ error: message }, status);

/** Blocks cross-site form posts: mutating requests must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

/** Wraps a handler: origin check for writes, friendly messages for UserError, nothing leaked otherwise. */
export function handler<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    if (req.method !== "GET" && !sameOrigin(req)) return fail("Forbidden", 403);
    try {
      return await fn(req, ...rest);
    } catch (e) {
      unstable_rethrow(e); // let Next.js's own control-flow signals through (prerender bail-outs etc.)
      if (e instanceof RateLimited) return fail(e.message, 429);
      if (e instanceof NotFoundError) return fail(e.message || "Not found", 404);
      if (e instanceof UserError) return fail(e.message, 400);
      console.error(e);
      const where = `${req.method} ${new URL(req.url).pathname.replace(/\/[a-z0-9]{20,}/gi, "/:id")}`;
      void notifyOps(`error:${where}`, `server error on ${where}`, `${where} failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 600));
      return fail("Something went wrong. Please try again.", 500);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}
