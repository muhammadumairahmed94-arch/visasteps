import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(),
  db: {
    clientDocument: {
      findFirst: vi.fn(),
      update:    vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth",      () => ({ currentStaff: mocks.staff, requestIp: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db",        () => ({ db: mocks.db }));
vi.mock("@/lib/ratelimit", () => ({ limit: vi.fn(), RateLimited: class extends Error {} }));
vi.mock("@/lib/documents", () => ({
  visibleCases: (u: { firmId: string; role: string; id?: string }) =>
    u.role === "ADMIN" ? { firmId: u.firmId } : { firmId: u.firmId, caseworkerId: u.id },
}));
vi.mock("@/lib/alerts",    () => ({ notifyOps: vi.fn() }));
vi.mock("next/server",    () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));

import { PATCH } from "@/app/api/staff/documents/[id]/assign/route";

const me = { id: "u1", firmId: "f1", role: "ADMIN" };

const makeDoc = (opts: {
  status?: string;
  assignedToOverride?: string | null;
  assignedTo?: string;
  hasSponsor?: boolean;
}) => ({
  id: "doc1",
  clientId: "c1",
  status: opts.status ?? "NEED",
  assignedToOverride: opts.assignedToOverride ?? null,
  checklistItem: { assignedTo: opts.assignedTo ?? "CLIENT" },
  client: {
    sponsorAccounts: opts.hasSponsor ? [{ id: "sp1" }] : [],
  },
});

function makeReq(assignedTo: string) {
  return new Request("http://localhost/api/staff/documents/doc1/assign", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Origin": "http://localhost", "Host": "localhost" },
    body: JSON.stringify({ assignedTo }),
  });
}
const ctx = { params: Promise.resolve({ id: "doc1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue(me);
  mocks.db.clientDocument.update.mockResolvedValue({});
  mocks.db.clientDocument.updateMany.mockResolvedValue({});
  mocks.db.auditLog.create.mockResolvedValue({});
});

describe("assign route — PATCH", () => {
  it("returns 401 when not signed in", async () => {
    mocks.staff.mockResolvedValue(null);
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({}));
    const res = await PATCH(makeReq("CLIENT"), ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when doc not found", async () => {
    mocks.db.clientDocument.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq("CLIENT"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid assignedTo", async () => {
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({ hasSponsor: true }));
    const res = await PATCH(makeReq("INVALID"), ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when assigning to SPONSOR with no active sponsor", async () => {
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({ hasSponsor: false }));
    const res = await PATCH(makeReq("SPONSOR"), ctx);
    expect(res.status).toBe(400);
  });

  it("sets assignedToOverride and audits", async () => {
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({ hasSponsor: true }));
    const res = await PATCH(makeReq("SPONSOR"), ctx);
    expect(res.status).toBe(200);
    expect(mocks.db.clientDocument.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "doc1" },
      data: { assignedToOverride: "SPONSOR" },
    }));
    const auditCall = mocks.db.auditLog.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("document.reassign.SPONSOR");
  });

  it("resets REDO to NEED when owner changes", async () => {
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({ status: "REDO", assignedTo: "SPONSOR", hasSponsor: true }));
    // Doc is currently SPONSOR-assigned; reassigning to CLIENT means effective owner changes
    await PATCH(makeReq("CLIENT"), ctx);
    expect(mocks.db.clientDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["doc1"] }, status: "REDO" }),
    }));
  });

  it("does not reset REDO when owner stays the same", async () => {
    // already CLIENT-assigned, reassigning to CLIENT → no change
    mocks.db.clientDocument.findFirst.mockResolvedValue(makeDoc({ status: "REDO", assignedTo: "CLIENT", hasSponsor: true }));
    await PATCH(makeReq("CLIENT"), ctx);
    expect(mocks.db.clientDocument.updateMany).not.toHaveBeenCalled();
  });
});
