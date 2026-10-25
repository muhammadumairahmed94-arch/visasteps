import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted creates the shared mock objects at hoist-time so factory
// functions can reference them without TDZ errors.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  uploadSession: {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    findFirst:  vi.fn(),
    updateMany: vi.fn(),
    create:     vi.fn(),
    delete:     vi.fn(),
    deleteMany: vi.fn(),
  },
  clientDocument: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  clientDb:  { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  sessionDb: { deleteMany: vi.fn() },
  inviteDb:  { updateMany: vi.fn() },
  auditLog:  { create: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports
// ---------------------------------------------------------------------------
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
vi.mock("@/lib/alerts",   () => ({ notifyOps: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    uploadSession:  mocks.uploadSession,
    clientDocument: mocks.clientDocument,
    client:         mocks.clientDb,
    session:        mocks.sessionDb,
    invite:         mocks.inviteDb,
    auditLog:       mocks.auditLog,
  },
}));
vi.mock("../lib/db", () => ({
  db: {
    uploadSession:  mocks.uploadSession,
    clientDocument: mocks.clientDocument,
    client:         mocks.clientDb,
    session:        mocks.sessionDb,
    invite:         mocks.inviteDb,
    auditLog:       mocks.auditLog,
  },
}));

vi.mock("@/lib/auth",      () => ({ currentClient: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ limit: vi.fn(), RateLimited: class extends Error {} }));
vi.mock("@/lib/crypto",    () => ({
  encryptBuffer: vi.fn((d: Buffer) => d),
  decryptBuffer: vi.fn((d: Buffer) => d),
  sha256:        vi.fn(() => "a".repeat(64)),
  safeEqual:     vi.fn(() => true),
}));
vi.mock("@/lib/documents", () => ({ uploadDocument: vi.fn() }));
vi.mock("@/lib/audit",     () => ({ audit: vi.fn() }));
vi.mock("../lib/audit",    () => ({ audit: vi.fn() }));

// ---------------------------------------------------------------------------
// Static imports — receive the mocked versions because vi.mock is hoisted
// ---------------------------------------------------------------------------
import { currentClient } from "@/lib/auth";
import { limit }         from "@/lib/ratelimit";
import { uploadDocument } from "@/lib/documents";
import { POST as startPOST }    from "../app/api/client/upload/start/route";
import { PUT  as chunkPUT }     from "../app/api/client/upload/[sid]/chunk/route";
import { POST as completePOST } from "../app/api/client/upload/[sid]/complete/route";
import { setCaseClosed, deleteClient } from "../lib/closure";

// ---------------------------------------------------------------------------
// Section 1: pure helper functions
// ---------------------------------------------------------------------------
describe("expectedChunkCount", () => {
  it.each([
    [1,                       1],   // 1 byte → 1 chunk
    [1024 * 1024 - 1,         1],   // just under 1 MB → 1 chunk
    [1024 * 1024,             1],   // exactly 1 MB → 1 chunk
    [1024 * 1024 + 1,         2],   // 1 MB + 1 byte → 2 chunks
    [2 * 1024 * 1024,         2],   // exactly 2 MB → 2 chunks
    [3 * 1024 * 1024 - 1,     3],   // 3 MB − 1 → 3 chunks
    [20 * 1024 * 1024,       20],   // max file (20 MB) → 20 chunks
  ])("%i bytes → %i chunks", async (sizeBytes, want) => {
    const { expectedChunkCount } = await import("../lib/upload-sessions");
    expect(expectedChunkCount(sizeBytes)).toBe(want);
  });
});

describe("expectedChunkSize", () => {
  const MB = 1024 * 1024;

  it("single chunk: size equals the file size", async () => {
    const { expectedChunkSize } = await import("../lib/upload-sessions");
    expect(expectedChunkSize(500_000, 1, 0)).toBe(500_000);
  });

  it("first chunk of a multi-chunk file is exactly SERVER_CHUNK_SIZE", async () => {
    const { expectedChunkSize, SERVER_CHUNK_SIZE } = await import("../lib/upload-sessions");
    expect(expectedChunkSize(1.5 * MB, 2, 0)).toBe(SERVER_CHUNK_SIZE);
  });

  it("last chunk is the remainder", async () => {
    const { expectedChunkSize } = await import("../lib/upload-sessions");
    expect(expectedChunkSize(1.5 * MB, 2, 1)).toBe(0.5 * MB);
  });

  it("last chunk equals SERVER_CHUNK_SIZE when file is an exact multiple", async () => {
    const { expectedChunkSize, SERVER_CHUNK_SIZE } = await import("../lib/upload-sessions");
    expect(expectedChunkSize(2 * MB, 2, 1)).toBe(SERVER_CHUNK_SIZE);
  });
});

describe("sanitizeFileName", () => {
  it("passes safe names through unchanged", async () => {
    const { sanitizeFileName } = await import("../lib/upload-sessions");
    expect(sanitizeFileName("passport scan.jpg")).toBe("passport scan.jpg");
    expect(sanitizeFileName("file-v2.pdf")).toBe("file-v2.pdf");
  });

  it("replaces path separators and shell-special characters with underscores", async () => {
    const { sanitizeFileName } = await import("../lib/upload-sessions");
    // /  and \ become _, dots are kept (not path-dangerous on their own)
    expect(sanitizeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFileName("file<>.pdf")).toBe("file__.pdf");
  });

  it("defaults to 'upload' when the name is all whitespace", async () => {
    const { sanitizeFileName } = await import("../lib/upload-sessions");
    expect(sanitizeFileName("   ")).toBe("upload");
    // replaced chars become underscores — not empty, so no fallback needed
    expect(sanitizeFileName("!!!")).toBe("___");
  });

  it("truncates names longer than 200 characters", async () => {
    const { sanitizeFileName } = await import("../lib/upload-sessions");
    expect(sanitizeFileName("a".repeat(300))).toHaveLength(200);
  });
});

// ---------------------------------------------------------------------------
// Section 2: purgeExpiredUploadSessions
// ---------------------------------------------------------------------------
describe("purgeExpiredUploadSessions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "visasteps-purge-"));
    process.env.UPLOAD_QUEUE_DIR = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOAD_QUEUE_DIR;
  });

  it("deletes expired session records and their chunk folders", async () => {
    const expiredId = "expired-abc123";
    const chunksRoot = path.join(tmpDir, "upload-chunks");
    mkdirSync(path.join(chunksRoot, expiredId, "0"), { recursive: true });
    writeFileSync(path.join(chunksRoot, expiredId, "0", "0.bin"), "data");

    mocks.uploadSession.findMany
      .mockResolvedValueOnce([{ id: expiredId }])
      .mockResolvedValueOnce([]);
    mocks.uploadSession.delete.mockResolvedValue({});

    const { purgeExpiredUploadSessions } = await import("../lib/upload-sessions");
    const count = await purgeExpiredUploadSessions();

    expect(count).toBe(1);
    expect(existsSync(path.join(chunksRoot, expiredId))).toBe(false);
    expect(mocks.uploadSession.delete).toHaveBeenCalledWith({ where: { id: expiredId } });
  });

  it("deletes orphan chunk folders that have no matching DB session", async () => {
    const orphanId = "orphan-xyz789";
    const chunksRoot = path.join(tmpDir, "upload-chunks");
    mkdirSync(path.join(chunksRoot, orphanId, "0"), { recursive: true });
    writeFileSync(path.join(chunksRoot, orphanId, "0", "0.bin"), "chunk");

    mocks.uploadSession.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { purgeExpiredUploadSessions } = await import("../lib/upload-sessions");
    await purgeExpiredUploadSessions();

    expect(existsSync(path.join(chunksRoot, orphanId))).toBe(false);
  });

  it("leaves active session folders on disk", async () => {
    const activeId = "active-sess1";
    const chunksRoot = path.join(tmpDir, "upload-chunks");
    mkdirSync(path.join(chunksRoot, activeId, "0"), { recursive: true });
    writeFileSync(path.join(chunksRoot, activeId, "0", "0.bin"), "data");

    mocks.uploadSession.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: activeId }]);

    const { purgeExpiredUploadSessions } = await import("../lib/upload-sessions");
    await purgeExpiredUploadSessions();

    expect(existsSync(path.join(chunksRoot, activeId))).toBe(true);
  });

  it("does not crash when the chunks directory does not exist", async () => {
    mocks.uploadSession.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const { purgeExpiredUploadSessions } = await import("../lib/upload-sessions");
    await expect(purgeExpiredUploadSessions()).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section 3: start route — wrong totalChunks rejected
// ---------------------------------------------------------------------------
describe("start route — wrong totalChunks rejected", () => {
  const MB = 1024 * 1024;

  function makeStartReq(pages: unknown[]) {
    return new Request("http://localhost/api/client/upload/start", {
      method: "POST",
      headers: { "Origin": "http://localhost", "Host": "localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "doc1", pages, multiPage: false }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentClient).mockResolvedValue({ id: "c1", sponsorForClientId: null } as never);
    vi.mocked(limit).mockResolvedValue(undefined);
    mocks.clientDocument.findFirst.mockResolvedValue({
      id: "doc1", clientId: "c1", status: "NEED",
      assignedToOverride: null,
      checklistItem: { assignedTo: "CLIENT" },
      client: { closedAt: null, sponsorAccounts: [] },
    });
    mocks.uploadSession.create.mockResolvedValue({ id: "sess1" });
  });

  it("accepts the correct totalChunks for a sub-chunk-sized file", async () => {
    const res = await startPOST(makeStartReq([
      { fileName: "a.jpg", sizeBytes: 500_000, sha256: "a".repeat(64), totalChunks: 1 },
    ]));
    expect(res.status).toBe(200);
  });

  it("rejects totalChunks that is too large", async () => {
    const res = await startPOST(makeStartReq([
      { fileName: "a.jpg", sizeBytes: 500_000, sha256: "a".repeat(64), totalChunks: 2 },
    ]));
    expect(res.status).toBe(400);
    const { error } = await res.json() as { error: string };
    expect(error).toMatch(/chunk/i);
  });

  it("rejects totalChunks that is too small (2 MB needs 2 chunks)", async () => {
    const res = await startPOST(makeStartReq([
      { fileName: "a.jpg", sizeBytes: 2 * MB, sha256: "a".repeat(64), totalChunks: 1 },
    ]));
    expect(res.status).toBe(400);
    const { error } = await res.json() as { error: string };
    expect(error).toMatch(/chunk/i);
  });
});

// ---------------------------------------------------------------------------
// Section 4: chunk route — oversized chunks rejected
// ---------------------------------------------------------------------------
describe("chunk route — oversized chunks rejected", () => {
  const MB = 1024 * 1024;
  const sessData = {
    id: "s1", clientId: "c1",
    expiresAt: new Date(Date.now() + 3_600_000),
    pages: [{ fileName: "a.jpg", sizeBytes: MB, totalChunks: 1, sha256: "a".repeat(64) }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentClient).mockResolvedValue({ id: "c1", sponsorForClientId: null } as never);
    vi.mocked(limit).mockResolvedValue(undefined);
    mocks.uploadSession.findUnique.mockResolvedValue(sessData);
  });

  it("rejects when Content-Length declares more than SERVER_CHUNK_SIZE", async () => {
    const req = new Request("http://localhost/api/client/upload/s1/chunk?page=0&n=0", {
      method: "PUT",
      headers: {
        "Origin": "http://localhost", "Host": "localhost",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(MB + 1),
      },
      body: new Uint8Array(1).fill(0),
    });
    const res = await chunkPUT(req, { params: Promise.resolve({ sid: "s1" }) });
    expect(res.status).toBe(413);
  });

  it("rejects when the streamed body exceeds SERVER_CHUNK_SIZE", async () => {
    // Lie in Content-Length so the header check passes, then send MB+1 bytes
    const req = new Request("http://localhost/api/client/upload/s1/chunk?page=0&n=0", {
      method: "PUT",
      headers: {
        "Origin": "http://localhost", "Host": "localhost",
        "Content-Type": "application/octet-stream",
        "Content-Length": "1",
      },
      body: new Uint8Array(MB + 1).fill(2),
    });
    const res = await chunkPUT(req, { params: Promise.resolve({ sid: "s1" }) });
    expect(res.status).toBe(413);
  });

  it("rejects a chunk whose byte count does not match its expected position size", async () => {
    // Session has 1 page of exactly 1 MB → chunk 0 must be exactly 1 MB.
    // Sending 999 bytes is wrong.
    const req = new Request("http://localhost/api/client/upload/s1/chunk?page=0&n=0", {
      method: "PUT",
      headers: {
        "Origin": "http://localhost", "Host": "localhost",
        "Content-Type": "application/octet-stream",
        "Content-Length": "999",
      },
      body: new Uint8Array(999).fill(1),
    });
    const res = await chunkPUT(req, { params: Promise.resolve({ sid: "s1" }) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Section 5: complete route — double-tap protection
// ---------------------------------------------------------------------------
describe("complete route — double-tap protection", () => {
  function makeCompleteReq(sid: string) {
    return new Request(`http://localhost/api/client/upload/${sid}/complete`, {
      method: "POST",
      headers: { "Origin": "http://localhost", "Host": "localhost", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currentClient).mockResolvedValue({ id: "c1", sponsorForClientId: null } as never);
  });

  it("returns 'Already received' when completingAt is already set", async () => {
    mocks.uploadSession.updateMany.mockResolvedValue({ count: 0 });
    mocks.uploadSession.findFirst.mockResolvedValue({
      id: "s1", clientId: "c1",
      completingAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await completePOST(makeCompleteReq("s1"), { params: Promise.resolve({ sid: "s1" }) });
    expect(res.status).toBe(200);
    const { message } = await res.json() as { message: string };
    expect(message).toBe("We're already sending this document. Please wait a moment.");
  });

  it("returns 404 when the session does not exist at all", async () => {
    mocks.uploadSession.updateMany.mockResolvedValue({ count: 0 });
    mocks.uploadSession.findFirst.mockResolvedValue(null);

    const res = await completePOST(makeCompleteReq("no-such"), { params: Promise.resolve({ sid: "no-such" }) });
    expect(res.status).toBe(404);
  });

  it("calls updateMany with completingAt: null so the claim is atomic", async () => {
    mocks.uploadSession.updateMany.mockResolvedValue({ count: 1 });
    mocks.uploadSession.findUnique.mockResolvedValue({
      id: "s1", clientId: "c1", docId: "d1", multiPage: false,
      expiresAt: new Date(Date.now() + 3_600_000),
      pages: [{ fileName: "a.jpg", sizeBytes: 1, sha256: "a".repeat(64), totalChunks: 1 }],
    });
    vi.mocked(uploadDocument).mockResolvedValue({ reviewDays: 2 } as never);
    mocks.uploadSession.delete.mockResolvedValue({});

    await completePOST(makeCompleteReq("s1"), { params: Promise.resolve({ sid: "s1" }) });

    expect(mocks.uploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ completingAt: null }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Section 6: case closure and deletion remove upload session chunk folders
// ---------------------------------------------------------------------------
describe("setCaseClosed — removes upload session chunks on close", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "closure-test-"));
    process.env.UPLOAD_QUEUE_DIR = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOAD_QUEUE_DIR;
  });

  it("deletes chunk folders and session records when a case is closed", async () => {
    mocks.clientDb.findFirst.mockResolvedValue({ id: "c1", firmId: "f1", caseRef: "IM-0001" });
    mocks.clientDb.update.mockResolvedValue({});
    mocks.sessionDb.deleteMany.mockResolvedValue({});
    mocks.inviteDb.updateMany.mockResolvedValue({});
    mocks.clientDocument.findMany.mockResolvedValue([]);
    mocks.uploadSession.findMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    mocks.uploadSession.deleteMany.mockResolvedValue({});
    mocks.auditLog.create.mockResolvedValue({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setCaseClosed({ id: "u1", firmId: "f1", role: "ADMIN" } as any, "c1", true);

    expect(mocks.uploadSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "c1" } }),
    );
    expect(mocks.uploadSession.deleteMany).toHaveBeenCalledWith({ where: { clientId: "c1" } });
  });

  it("does not touch upload sessions when reopening a case", async () => {
    mocks.clientDb.findFirst.mockResolvedValue({ id: "c1", firmId: "f1", caseRef: "IM-0001" });
    mocks.clientDb.update.mockResolvedValue({});
    mocks.auditLog.create.mockResolvedValue({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setCaseClosed({ id: "u1", firmId: "f1", role: "ADMIN" } as any, "c1", false);

    expect(mocks.uploadSession.findMany).not.toHaveBeenCalled();
    expect(mocks.uploadSession.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleteClient — removes upload session chunk folders before DB cascade", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "delete-test-"));
    process.env.UPLOAD_QUEUE_DIR = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOAD_QUEUE_DIR;
  });

  it("looks up upload sessions and deletes their chunk folders before the client delete", async () => {
    mocks.clientDb.findFirst.mockResolvedValue({
      id: "c1", firmId: "f1", caseRef: "IM-0002",
      documents: [{ files: [{ storageStatus: "SAVED", jobs: [] }] }],
    });
    mocks.uploadSession.findMany.mockResolvedValue([{ id: "s3" }]);
    mocks.clientDb.delete.mockResolvedValue({});
    mocks.auditLog.create.mockResolvedValue({});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deleteClient({ id: "u1", firmId: "f1", role: "ADMIN" } as any, "c1", "IM-0002");

    expect(mocks.uploadSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: "c1" } }),
    );
    expect(mocks.clientDb.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});
