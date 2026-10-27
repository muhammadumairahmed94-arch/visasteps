import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockProcessDocCheckRuns = vi.fn().mockResolvedValue(undefined);
const mockProcessDraftRuns = vi.fn().mockResolvedValue(undefined);
const mockKeepAlive = vi.fn().mockResolvedValue(undefined);
const mockProcessQueue = vi.fn().mockResolvedValue(undefined);
const mockSendDueReminders = vi.fn().mockResolvedValue({ missing: 0, redo: 0 });
const mockPurgeExpiredUploadSessions = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/doc-check-runs", () => ({ processDocCheckRuns: mockProcessDocCheckRuns }));
vi.mock("@/lib/draft-runs", () => ({ processDraftRuns: mockProcessDraftRuns }));
vi.mock("@/lib/storage-queue", () => ({ keepAlive: mockKeepAlive, processQueue: mockProcessQueue }));
vi.mock("@/lib/reminders", () => ({ sendDueReminders: mockSendDueReminders }));
vi.mock("@/lib/upload-sessions", () => ({ purgeExpiredUploadSessions: mockPurgeExpiredUploadSessions }));
vi.mock("@/lib/health", () => ({ backupAgeHours: vi.fn(), backupsConfigured: vi.fn().mockReturnValue(false) }));
vi.mock("@/lib/alerts", () => ({ notifyOps: vi.fn() }));

describe("startBackgroundJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const g = globalThis as Record<string, unknown>;
    delete g.jobsTimer;
    delete g.jobsStartedAt;
    delete g.lastReminders;
    vi.clearAllMocks();
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    if (g.jobsTimer) { clearInterval(g.jobsTimer as ReturnType<typeof setInterval>); delete g.jobsTimer; }
    vi.useRealTimers();
  });

  it("calls processDocCheckRuns on each tick", async () => {
    const { startBackgroundJobs } = await import("@/lib/jobs");
    startBackgroundJobs();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockProcessDocCheckRuns).toHaveBeenCalledOnce();
  });

  it("calls processDocCheckRuns on every subsequent tick", async () => {
    const { startBackgroundJobs } = await import("@/lib/jobs");
    startBackgroundJobs();

    await vi.advanceTimersByTimeAsync(180_000); // 3 ticks

    expect(mockProcessDocCheckRuns).toHaveBeenCalledTimes(3);
  });

  it("does not start a second timer if already running", async () => {
    const { startBackgroundJobs } = await import("@/lib/jobs");
    startBackgroundJobs();
    startBackgroundJobs(); // second call is a no-op

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockProcessDocCheckRuns).toHaveBeenCalledOnce();
  });
});
