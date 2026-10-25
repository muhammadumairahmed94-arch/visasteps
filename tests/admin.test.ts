import { beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// ── hoisted mocks ──────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  checklistItem: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  clientDocument: { findMany: vi.fn(), updateMany: vi.fn() },
  resetRedoForDocs: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    checklistItem: mocks.checklistItem,
    clientDocument: mocks.clientDocument,
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/sponsor-ops", () => ({
  resetRedoForDocs: mocks.resetRedoForDocs,
  cancelSponsor: vi.fn(),
}));
vi.mock("@/lib/accounts", () => ({ sendStaffLink: vi.fn() }));
vi.mock("@/lib/onedrive-connection", () => ({ getConnection: vi.fn() }));

import { changeItem } from "@/lib/admin";

const admin = { id: "u1", firmId: "f1", role: "ADMIN", name: "Admin", email: "admin@test.com" } as Parameters<typeof changeItem>[0];

const baseItem = {
  id: "item1",
  routeId: "route1",
  assignedTo: "CLIENT",
  folder: "01 Identity",
  groupLabel: "Identity",
  title: "Passport",
  why: "Proof of identity",
  howToGet: null,
  exampleImage: null,
  dateWindow: null,
  required: true,
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checklistItem.findFirst.mockResolvedValue(baseItem);
  mocks.checklistItem.update.mockResolvedValue({});
  mocks.clientDocument.findMany.mockResolvedValue([]);
  mocks.clientDocument.updateMany.mockResolvedValue({});
  mocks.resetRedoForDocs.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe("changeItem — assignedTo", () => {
  it("saves assignedTo and audits checklist.assignedTo.SPONSOR when changed", async () => {
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.checklistItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedTo: "SPONSOR" }),
    }));
    const auditCall = mocks.audit.mock.calls[0][0];
    expect(auditCall.action).toBe("checklist.assignedTo.SPONSOR");
  });

  it("resets REDO docs when assignedTo changes and there are REDO docs", async () => {
    mocks.clientDocument.findMany.mockResolvedValue([
      { id: "doc1", status: "REDO", missingAt: null },
      { id: "doc2", status: "NEED", missingAt: null },
    ]);
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.resetRedoForDocs).toHaveBeenCalledWith(["doc1"]);
  });

  it("clears missing flags when assignedTo changes and docs have missingAt set", async () => {
    const past = new Date("2026-10-01");
    mocks.clientDocument.findMany.mockResolvedValue([
      { id: "doc3", status: "NEED", missingAt: past },
    ]);
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.clientDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["doc3"] } },
      data: { missingReason: null, missingAt: null, missingResponse: null },
    }));
  });

  it("does not reset docs when assignedTo stays the same", async () => {
    // item.assignedTo is already CLIENT, sending CLIENT → no change
    await changeItem(admin, "item1", { assignedTo: "CLIENT" });
    expect(mocks.clientDocument.findMany).not.toHaveBeenCalled();
    expect(mocks.resetRedoForDocs).not.toHaveBeenCalled();
    const auditCall = mocks.audit.mock.calls[0][0];
    expect(auditCall.action).toBe("admin.item.edit");
  });

  it("does not reset docs when assignedTo is not in the input", async () => {
    await changeItem(admin, "item1", { title: "Updated title", why: "New reason here" });
    expect(mocks.clientDocument.findMany).not.toHaveBeenCalled();
    expect(mocks.resetRedoForDocs).not.toHaveBeenCalled();
    const auditCall = mocks.audit.mock.calls[0][0];
    expect(auditCall.action).toBe("admin.item.edit");
  });

  it("does not call resetRedoForDocs when no REDO docs exist", async () => {
    mocks.clientDocument.findMany.mockResolvedValue([
      { id: "doc4", status: "NEED", missingAt: null },
    ]);
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.resetRedoForDocs).not.toHaveBeenCalled();
  });

  it("does not call updateMany when no docs have missingAt", async () => {
    mocks.clientDocument.findMany.mockResolvedValue([
      { id: "doc5", status: "REDO", missingAt: null },
    ]);
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.clientDocument.updateMany).not.toHaveBeenCalled();
  });

  it("queries only docs without override and with active sponsor", async () => {
    await changeItem(admin, "item1", { assignedTo: "SPONSOR" });
    expect(mocks.clientDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        checklistItemId: "item1",
        assignedToOverride: null,
        client: { sponsorAccounts: { some: { closedAt: null } } },
      }),
    }));
  });
});

describe("changeItem — admin.item.edit when assignedTo unchanged", () => {
  it("audits admin.item.edit for a title-only edit", async () => {
    await changeItem(admin, "item1", { title: "New title here", why: "New reason sentence" });
    const auditCall = mocks.audit.mock.calls[0][0];
    expect(auditCall.action).toBe("admin.item.edit");
  });
});

describe("redo reminder email — no note text", () => {
  it("redo reminder email does not include caseworker note text", () => {
    const src = readFileSync(new URL("../lib/reminders.ts", import.meta.url).pathname, "utf8");
    expect(src).not.toMatch(/d\.note/);
  });
});
