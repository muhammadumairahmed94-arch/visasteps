import { beforeEach, describe, it, expect, vi } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  class RateLimited extends Error {
    constructor() { super("Too many attempts. Please wait a few minutes and try again."); }
  }
  return { staff: vi.fn(), firm: vi.fn(), doc: vi.fn(), audit: vi.fn(), hit: vi.fn(), RateLimited };
});

vi.mock("@/lib/auth", () => ({ currentStaff: mocks.staff, requestIp: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db", () => ({
  db: {
    firm: { findUniqueOrThrow: mocks.firm },
    clientDocument: { findFirst: mocks.doc },
    rateLimit: { deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/ratelimit", () => ({
  hit: mocks.hit,
  limit: async (_name: string, id: string) => {
    if (!(await mocks.hit(_name, id))) throw new mocks.RateLimited();
  },
  RateLimited: mocks.RateLimited,
}));
vi.mock("@/lib/documents", () => ({
  visibleCases: (u: { firmId: string; role: string; id?: string }) =>
    u.role === "ADMIN" ? { firmId: u.firmId } : { firmId: u.firmId, caseworkerId: u.id },
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

import { POST } from "@/app/api/staff/ai/analyse/route";

const me = { id: "u1", firmId: "f1", role: "CASEWORKER" };
const doc = { id: "doc1", checklistItem: { title: "Passport" } };

function makeReq(body: object) {
  return new Request("http://localhost/api/staff/ai/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("AI_PROVIDER", "fake");
  mocks.staff.mockResolvedValue(me);
  mocks.firm.mockResolvedValue({ aiEnabled: true });
  mocks.doc.mockResolvedValue(doc);
  mocks.audit.mockResolvedValue(undefined);
  mocks.hit.mockResolvedValue(true);
});

describe("POST /api/staff/ai/analyse", () => {
  it("returns 401 when not signed in", async () => {
    mocks.staff.mockResolvedValue(null);
    const res = await POST(makeReq({ documentId: "doc1", text: "Some document text here" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when aiEnabled is false", async () => {
    mocks.firm.mockResolvedValue({ aiEnabled: false });
    const res = await POST(makeReq({ documentId: "doc1", text: "Some document text here" }));
    expect(res.status).toBe(403);
  });

  it("returns 503 when AI_PROVIDER is off", async () => {
    vi.stubEnv("AI_PROVIDER", "off");
    const res = await POST(makeReq({ documentId: "doc1", text: "Some document text here" }));
    expect(res.status).toBe(503);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mocks.hit.mockResolvedValue(false);
    const res = await POST(makeReq({ documentId: "doc1", text: "Some document text here" }));
    expect(res.status).toBe(429);
  });

  it("returns 404 when document is not found (or belongs to another caseworker)", async () => {
    mocks.doc.mockResolvedValue(null);
    const res = await POST(makeReq({ documentId: "other-doc", text: "Some document text here" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when text is too short", async () => {
    const res = await POST(makeReq({ documentId: "doc1", text: "short" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when text is too long", async () => {
    const res = await POST(makeReq({ documentId: "doc1", text: "x".repeat(12_001) }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with summary and flags on success (fake provider)", async () => {
    const res = await POST(makeReq({ documentId: "doc1", text: "John Smith passport issued 01/01/2020 valid until 01/01/2030" }));
    expect(res.status).toBe(200);
    const data = await res.json() as { summary: string; flags: string[] };
    expect(typeof data.summary).toBe("string");
    expect(Array.isArray(data.flags)).toBe(true);
  });

  it("writes an audit log on success", async () => {
    await POST(makeReq({ documentId: "doc1", text: "John Smith passport number AB123456 valid until 2030" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "ai.analyse",
      targetId: "doc1",
    }));
  });

  it("caseworker A cannot analyse caseworker B's document (404 via visibleCases)", async () => {
    // visibleCases scopes by caseworkerId; when the doc.findFirst returns null, we get 404
    mocks.doc.mockResolvedValue(null);
    const res = await POST(makeReq({ documentId: "doc-owned-by-B", text: "Some document text here" }));
    expect(res.status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not write audit log on failure", async () => {
    mocks.doc.mockResolvedValue(null);
    await POST(makeReq({ documentId: "doc1", text: "Some document text here" }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
