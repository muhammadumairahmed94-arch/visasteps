import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  firm: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  client: { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
  uploadSession: { findMany: vi.fn() },
  fileUpload: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  audit: vi.fn(),
  deleteSessionChunks: vi.fn(),
  cancelSponsor: vi.fn(),
  deleteFolder: vi.fn(),
  sendSafely: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    firm: mocks.firm,
    client: mocks.client,
    uploadSession: mocks.uploadSession,
    fileUpload: mocks.fileUpload,
    user: mocks.user,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit, auditView: vi.fn() }));
vi.mock("@/lib/upload-sessions", () => ({ deleteSessionChunks: mocks.deleteSessionChunks }));
vi.mock("@/lib/sponsor-ops", () => ({ cancelSponsor: mocks.cancelSponsor }));
vi.mock("@/lib/adapters/storage", () => ({
  storage: () => ({ deleteFolder: mocks.deleteFolder }),
  cleanSegment: (s: string) => s.replace(/["*:<>?/\\|#%]/g, "").trim(),
}));
vi.mock("@/lib/adapters/email", () => ({ sendSafely: mocks.sendSafely }));
vi.mock("@/lib/accounts", () => ({ appUrl: () => "http://localhost:3000" }));

import { retentionDueDate, listRetentionCases, retentionDeleteCase, extendRetention, setLegalHold, runRetentionJob } from "@/lib/retention";

const admin = { id: "u1", firmId: "f1", role: "ADMIN" as const, name: "Admin", email: "admin@test.com" } as Parameters<typeof retentionDeleteCase>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadSession.findMany.mockResolvedValue([]);
  mocks.fileUpload.findMany.mockResolvedValue([]);
  mocks.audit.mockResolvedValue(undefined);
  mocks.deleteSessionChunks.mockResolvedValue(undefined);
  mocks.cancelSponsor.mockResolvedValue(undefined);
  mocks.deleteFolder.mockResolvedValue(undefined);
  mocks.sendSafely.mockResolvedValue(true);
  mocks.user.findMany.mockResolvedValue([]);
});

describe("retentionDueDate", () => {
  it("returns null for open cases", () => {
    expect(retentionDueDate(null, 6)).toBeNull();
  });

  it("adds retentionYears to closedAt", () => {
    const closed = new Date("2020-06-15");
    const due = retentionDueDate(closed, 6);
    expect(due?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("handles leap-year edge: Feb 29 + 1 year = Feb 28", () => {
    const closed = new Date("2024-02-29");
    const due = retentionDueDate(closed, 1);
    expect(due).not.toBeNull();
    expect(due!.getFullYear()).toBe(2025);
  });

  it("retainUntil takes precedence when it is later", () => {
    const closed = new Date("2020-06-15"); // standard due: 2026-06-15
    const retainUntil = new Date("2028-01-01");
    const due = retentionDueDate(closed, 6, retainUntil);
    expect(due?.toISOString().slice(0, 10)).toBe("2028-01-01");
  });

  it("closedAt + retentionYears wins when retainUntil is earlier", () => {
    const closed = new Date("2020-06-15"); // standard due: 2026-06-15
    const retainUntil = new Date("2025-01-01"); // earlier than standard due
    const due = retentionDueDate(closed, 6, retainUntil);
    expect(due?.toISOString().slice(0, 10)).toBe("2026-06-15");
  });
});

describe("listRetentionCases", () => {
  it("returns only cases due within 30 days or overdue", async () => {
    mocks.firm.findUniqueOrThrow.mockResolvedValue({ retentionYears: 6 });
    const now = Date.now();
    const msPerDay = 86_400_000;
    const closedSoon = new Date(now - (6 * 365.25 * msPerDay) + 10 * msPerDay);
    const closedFar = new Date(now - (6 * 365.25 * msPerDay) + 40 * msPerDay);
    const closedOverdue = new Date(now - (6 * 365.25 * msPerDay) - 5 * msPerDay);
    mocks.client.findMany.mockResolvedValue([
      { id: "c1", caseRef: "IM-1001", firstName: "Ali", lastName: "Khan", email: "ali@example.com", closedAt: closedSoon, legalHold: false, legalHoldReason: null, retainUntil: null, deletionPendingAt: null, deletionPendingTries: 0 },
      { id: "c2", caseRef: "IM-1002", firstName: "Sara", lastName: "Ali", email: "sara@example.com", closedAt: closedFar, legalHold: false, legalHoldReason: null, retainUntil: null, deletionPendingAt: null, deletionPendingTries: 0 },
      { id: "c3", caseRef: "IM-1003", firstName: "Bilal", lastName: "Yousuf", email: "bilal@example.com", closedAt: closedOverdue, legalHold: false, legalHoldReason: null, retainUntil: null, deletionPendingAt: null, deletionPendingTries: 0 },
    ]);
    const result = await listRetentionCases("f1");
    expect(result.map((r) => r.caseRef)).toContain("IM-1001");
    expect(result.map((r) => r.caseRef)).toContain("IM-1003");
    expect(result.map((r) => r.caseRef)).not.toContain("IM-1002");
  });

  it("includes legalHold info", async () => {
    mocks.firm.findUniqueOrThrow.mockResolvedValue({ retentionYears: 6 });
    const closedAt = new Date(Date.now() - (6 * 365.25 * 86_400_000) - 86_400_000);
    mocks.client.findMany.mockResolvedValue([
      { id: "c1", caseRef: "IM-2001", firstName: "A", lastName: "B", email: "a@b.com", closedAt, legalHold: true, legalHoldReason: "Litigation", retainUntil: null, deletionPendingAt: null, deletionPendingTries: 0 },
    ]);
    const result = await listRetentionCases("f1");
    expect(result[0].legalHold).toBe(true);
    expect(result[0].legalHoldReason).toBe("Litigation");
  });

  it("always includes deletion-pending cases regardless of due date", async () => {
    mocks.firm.findUniqueOrThrow.mockResolvedValue({ retentionYears: 6 });
    // Due in 60 days — normally outside the 30-day window, but has deletionPendingAt set
    const closedAt = new Date(Date.now() - (6 * 365.25 * 86_400_000) + 60 * 86_400_000);
    mocks.client.findMany.mockResolvedValue([
      { id: "c1", caseRef: "IM-3001", firstName: "A", lastName: "B", email: "a@b.com", closedAt, legalHold: false, legalHoldReason: null, retainUntil: null, deletionPendingAt: new Date(), deletionPendingTries: 2 },
    ]);
    const result = await listRetentionCases("f1");
    expect(result).toHaveLength(1);
    expect(result[0].deletionPendingAt).not.toBeNull();
    expect(result[0].deletionPendingTries).toBe(2);
  });
});

describe("retentionDeleteCase", () => {
  const closedAt = new Date("2018-01-01");
  const baseClient = {
    id: "c1",
    caseRef: "IM-1001",
    firmId: "f1",
    firstName: "Ali",
    lastName: "Khan",
    closedAt,
    legalHold: false,
    documents: [],
  };

  beforeEach(() => {
    mocks.firm.findUniqueOrThrow.mockResolvedValue({ retentionYears: 6 });
    mocks.client.findFirst.mockResolvedValue(baseClient);
    mocks.client.delete.mockResolvedValue({});
    mocks.client.update.mockResolvedValue({});
  });

  it("deletes the DB record after OneDrive folder deletion succeeds", async () => {
    mocks.fileUpload.findMany.mockResolvedValue([{ folderPath: "Clients/Khan_Ali_IM-1001/01 Identity" }]);
    await retentionDeleteCase(admin, "c1");
    expect(mocks.deleteFolder).toHaveBeenCalledWith(["Clients", "Khan_Ali_IM-1001"]);
    expect(mocks.client.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "retention.delete", targetId: "IM-1001" }));
  });

  it("derives distinct folders from FileUpload paths — handles renamed client", async () => {
    // Old uploads in one folder, new uploads after rename in another
    mocks.fileUpload.findMany.mockResolvedValue([
      { folderPath: "Clients/Old_Name_IM-1001/01 Identity" },
      { folderPath: "Clients/New_Name_IM-1001/01 Identity" },
      { folderPath: "Clients/Old_Name_IM-1001/02 Finance" }, // duplicate — deduplicated
    ]);
    await retentionDeleteCase(admin, "c1");
    expect(mocks.deleteFolder).toHaveBeenCalledTimes(2);
    expect(mocks.deleteFolder).toHaveBeenCalledWith(["Clients", "Old_Name_IM-1001"]);
    expect(mocks.deleteFolder).toHaveBeenCalledWith(["Clients", "New_Name_IM-1001"]);
    expect(mocks.client.delete).toHaveBeenCalled();
  });

  it("marks case as deletion-pending when OneDrive fails — does NOT delete DB record", async () => {
    mocks.fileUpload.findMany.mockResolvedValue([{ folderPath: "Clients/Khan_Ali_IM-1001/01 Identity" }]);
    mocks.deleteFolder.mockRejectedValue(new Error("network error"));
    const msg = await retentionDeleteCase(admin, "c1");
    expect(msg).toContain("retry");
    expect(mocks.client.delete).not.toHaveBeenCalled();
    expect(mocks.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deletionPendingAt: expect.any(Date), deletionPendingTries: 1 }),
    }));
  });

  it("deletes DB even when no FileUpload rows exist (no files uploaded)", async () => {
    mocks.fileUpload.findMany.mockResolvedValue([]);
    await retentionDeleteCase(admin, "c1");
    expect(mocks.deleteFolder).not.toHaveBeenCalled();
    expect(mocks.client.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("refuses to delete a case on legal hold", async () => {
    mocks.client.findFirst.mockResolvedValue({ ...baseClient, legalHold: true });
    await expect(retentionDeleteCase(admin, "c1")).rejects.toThrow("on legal hold");
  });

  it("refuses to delete an open case", async () => {
    mocks.client.findFirst.mockResolvedValue({ ...baseClient, closedAt: null });
    await expect(retentionDeleteCase(admin, "c1")).rejects.toThrow("closed cases");
  });

  it("rejects non-admins", async () => {
    const caseworker = { ...admin, role: "CASEWORKER" as const };
    await expect(retentionDeleteCase(caseworker, "c1")).rejects.toThrow("Only admins");
  });
});

describe("extendRetention", () => {
  beforeEach(() => {
    mocks.firm.findUniqueOrThrow.mockResolvedValue({ retentionYears: 6 });
    mocks.client.findFirst.mockResolvedValue({
      id: "c1", caseRef: "IM-1001", firmId: "f1",
      closedAt: new Date("2020-01-01"), retainUntil: null, sponsorForClientId: null,
    });
    mocks.client.update.mockResolvedValue({});
  });

  it("sets retainUntil to currentDueDate + extraYears (no prior extension)", async () => {
    const msg = await extendRetention(admin, "c1", 2, "Client requested extension");
    expect(msg).toContain("2 years");
    const updateCall = mocks.client.update.mock.calls[0][0];
    const newRetainUntil: Date = updateCall.data.retainUntil;
    // closedAt 2020-01-01 + 6 retentionYears = due 2026-01-01; +2 extra = 2028-01-01
    expect(newRetainUntil.getFullYear()).toBe(2028);
  });

  it("extends from existing retainUntil when already extended", async () => {
    mocks.client.findFirst.mockResolvedValue({
      id: "c1", caseRef: "IM-1001", firmId: "f1",
      closedAt: new Date("2020-01-01"), retainUntil: new Date("2028-01-01"), sponsorForClientId: null,
    });
    await extendRetention(admin, "c1", 1, "Still under review");
    const updateCall = mocks.client.update.mock.calls[0][0];
    expect(updateCall.data.retainUntil.getFullYear()).toBe(2029);
  });

  it("rejects missing reason", async () => {
    await expect(extendRetention(admin, "c1", 2, "")).rejects.toThrow("reason");
    await expect(extendRetention(admin, "c1", 2, "   ")).rejects.toThrow("reason");
  });

  it("rejects invalid year values", async () => {
    await expect(extendRetention(admin, "c1", 0, "reason")).rejects.toThrow("1–10");
    await expect(extendRetention(admin, "c1", 11, "reason")).rejects.toThrow("1–10");
  });
});

describe("setLegalHold", () => {
  beforeEach(() => {
    mocks.client.findFirst.mockResolvedValue({ id: "c1", caseRef: "IM-1001", firmId: "f1", sponsorForClientId: null });
    mocks.client.update.mockResolvedValue({});
  });

  it("places a hold with a reason", async () => {
    const msg = await setLegalHold(admin, "c1", true, "Active litigation");
    expect(msg).toContain("Legal hold placed");
    expect(mocks.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalHold: true, legalHoldReason: "Active litigation" }),
    }));
  });

  it("requires a reason when placing a hold", async () => {
    await expect(setLegalHold(admin, "c1", true, "")).rejects.toThrow("reason");
  });

  it("clears a hold", async () => {
    const msg = await setLegalHold(admin, "c1", false, "");
    expect(msg).toContain("removed");
    expect(mocks.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ legalHold: false, legalHoldReason: null }),
    }));
  });
});

describe("runRetentionJob — pending retry", () => {
  it("retries a pending case and deletes it when OneDrive succeeds", async () => {
    const now = Date.now();
    const closedAt = new Date(now - (6 * 365.25 * 86_400_000) - 86_400_000);
    mocks.firm.findMany.mockResolvedValue([{ id: "f1", name: "Test Firm", retentionYears: 6 }]);
    mocks.client.findMany.mockResolvedValue([{
      id: "c1", caseRef: "IM-5001", firstName: "A", lastName: "B", email: "a@b.com",
      closedAt, retainUntil: null, legalHold: false, deletionPendingAt: new Date(), deletionPendingTries: 1,
    }]);
    mocks.fileUpload.findMany.mockResolvedValue([{ folderPath: "Clients/A_B_IM-5001/01 Identity" }]);
    mocks.client.delete.mockResolvedValue({});
    mocks.user.findMany.mockResolvedValue([]);

    await runRetentionJob();

    expect(mocks.deleteFolder).toHaveBeenCalledWith(["Clients", "A_B_IM-5001"]);
    expect(mocks.client.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "retention.delete", targetId: "IM-5001" }));
  });

  it("increments deletionPendingTries and emails admins after 3 fails", async () => {
    const now = Date.now();
    const closedAt = new Date(now - (6 * 365.25 * 86_400_000) - 86_400_000);
    mocks.firm.findMany.mockResolvedValue([{ id: "f1", name: "Test Firm", retentionYears: 6 }]);
    mocks.client.findMany.mockResolvedValue([{
      id: "c1", caseRef: "IM-5002", firstName: "A", lastName: "B", email: "a@b.com",
      closedAt, retainUntil: null, legalHold: false, deletionPendingAt: new Date(), deletionPendingTries: 2,
    }]);
    mocks.fileUpload.findMany.mockResolvedValue([{ folderPath: "Clients/A_B_IM-5002/01 Identity" }]);
    mocks.deleteFolder.mockRejectedValue(new Error("OneDrive down"));
    mocks.client.update.mockResolvedValue({});
    mocks.user.findMany.mockResolvedValue([{ email: "admin@firm.com" }]);

    await runRetentionJob();

    expect(mocks.client.delete).not.toHaveBeenCalled();
    expect(mocks.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deletionPendingTries: 3 }),
    }));
    expect(mocks.sendSafely).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@firm.com",
      subject: expect.stringContaining("IM-5002"),
    }));
  });

  it("marks a newly-due case as deletion-pending when OneDrive fails on first attempt", async () => {
    const now = Date.now();
    const closedAt = new Date(now - (6 * 365.25 * 86_400_000) - 86_400_000);
    mocks.firm.findMany.mockResolvedValue([{ id: "f1", name: "Test Firm", retentionYears: 6 }]);
    mocks.client.findMany.mockResolvedValue([{
      id: "c1", caseRef: "IM-5003", firstName: "A", lastName: "B", email: "a@b.com",
      closedAt, retainUntil: null, legalHold: false, deletionPendingAt: null, deletionPendingTries: 0,
    }]);
    mocks.fileUpload.findMany.mockResolvedValue([{ folderPath: "Clients/A_B_IM-5003/01 Identity" }]);
    mocks.deleteFolder.mockRejectedValue(new Error("OneDrive down"));
    mocks.client.update.mockResolvedValue({});
    mocks.user.findMany.mockResolvedValue([]);

    await runRetentionJob();

    expect(mocks.client.delete).not.toHaveBeenCalled();
    expect(mocks.client.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deletionPendingAt: expect.any(Date), deletionPendingTries: 1 }),
    }));
  });
});
