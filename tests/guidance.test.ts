import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractHtmlText, isStale } from "@/lib/guidance";

/* ── extractHtmlText — pure function, no mocks needed ──────────────────── */

describe("extractHtmlText", () => {
  it("removes script blocks entirely", () => {
    const html = '<html><body><script>alert("xss")</script>Hello</body></html>';
    const result = extractHtmlText(html);
    expect(result).not.toContain("alert");
    expect(result).toContain("Hello");
  });

  it("removes style blocks entirely", () => {
    const html = "<html><head><style>.a { color: red }</style></head><body>Content</body></html>";
    const result = extractHtmlText(html);
    expect(result).not.toContain("color");
    expect(result).toContain("Content");
  });

  it("removes multi-line script blocks", () => {
    const html = "before<script>\nfunction evil() {}\nevil();\n</script>after";
    expect(extractHtmlText(html)).toBe("before after");
  });

  it("strips all HTML tags", () => {
    expect(extractHtmlText("<h1>Title</h1><p>Body text.</p>")).toBe("Title Body text.");
  });

  it("decodes &amp; &lt; &gt; &quot; &apos; &nbsp; entities", () => {
    const text = "&amp; &lt;p&gt; &quot;hello&quot; &apos;world&apos; &nbsp;text";
    expect(extractHtmlText(text)).toBe("& <p> \"hello\" 'world' text");
  });

  it("decodes numeric character references", () => {
    expect(extractHtmlText("&#65;&#66;&#67;")).toBe("ABC");
  });

  it("collapses whitespace", () => {
    expect(extractHtmlText("  Hello   \n  World  ")).toBe("Hello World");
  });

  it("truncates output to 100,000 characters", () => {
    const longText = "A".repeat(200_000);
    expect(extractHtmlText(longText)).toHaveLength(100_000);
  });
});

/* ── isStale — pure function ────────────────────────────────────────────── */

describe("isStale", () => {
  const now = new Date();

  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };

  const monthsAgo = (n: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - n);
    d.setDate(d.getDate() - 1); // push it just past the boundary
    return d;
  };

  it("returns false when reviewed recently (within review period)", () => {
    expect(isStale({ uploadedAt: daysAgo(365), lastReviewedAt: daysAgo(30), status: "ACTIVE" }, 3)).toBe(false);
  });

  it("returns true when last reviewed more than N months ago", () => {
    expect(isStale({ uploadedAt: daysAgo(365), lastReviewedAt: monthsAgo(4), status: "ACTIVE" }, 3)).toBe(true);
  });

  it("uses uploadedAt as fallback when lastReviewedAt is null", () => {
    expect(isStale({ uploadedAt: monthsAgo(4), lastReviewedAt: null, status: "ACTIVE" }, 3)).toBe(true);
    expect(isStale({ uploadedAt: daysAgo(30), lastReviewedAt: null, status: "ACTIVE" }, 3)).toBe(false);
  });

  it("always returns false for SUPERSEDED sources", () => {
    expect(isStale({ uploadedAt: daysAgo(3650), lastReviewedAt: null, status: "SUPERSEDED" }, 1)).toBe(false);
  });

  it("is not stale when review period matches elapsed time exactly (boundary is exclusive)", () => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    d.setDate(d.getDate() + 1); // one day before the boundary
    expect(isStale({ uploadedAt: d, lastReviewedAt: null, status: "ACTIVE" }, 3)).toBe(false);
  });
});

/* ── uploadGuidance — auth, validation and virus scan ───────────────────── */

const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockAggregate = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    route: { findMany: (...a: unknown[]) => mockFindMany(...a) },
    guidanceSource: { create: (...a: unknown[]) => mockCreate(...a) },
    guidanceSourceType: { aggregate: (...a: unknown[]) => mockAggregate(...a) },
  },
}));

const mockSave = vi.fn();
vi.mock("@/lib/adapters/storage", () => ({
  storage: () => ({ save: (...a: unknown[]) => mockSave(...a) }),
  cleanSegment: (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_"),
}));

const mockScan = vi.fn();
vi.mock("@/lib/virus", () => ({
  scan: (...a: unknown[]) => mockScan(...a),
  scanningEnabled: () => true,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const mockDetectKind = vi.fn();
vi.mock("@/lib/files", () => ({
  detectKind: (...a: unknown[]) => mockDetectKind(...a),
}));

const ADMIN = { id: "admin1", firmId: "firm1", role: "ADMIN" } as Parameters<typeof import("@/lib/guidance").uploadGuidance>[0];
// Buffer starts with PDF magic bytes so mockDetectKind can return "pdf"
const PDF_FILE = {
  name: "guidance.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 minimal content"),
};
const VALID_META = {
  title: "Appendix FM guidance",
  govukUrl: "https://www.gov.uk/guidance/appendix-fm",
  routeIds: ["route1"],
};

describe("uploadGuidance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindMany.mockResolvedValue([{ id: "route1" }]);
    mockScan.mockResolvedValue({ clean: true });
    mockSave.mockResolvedValue({ itemId: "onedrive123", webUrl: null });
    mockCreate.mockResolvedValue({ id: "src1" });
    // By default, PDF_FILE buffer is detected as "pdf"
    mockDetectKind.mockImplementation((buf: Buffer) => {
      const s = buf.toString("ascii", 0, 5);
      return Promise.resolve(s === "%PDF-" ? "pdf" : null);
    });
  });

  it("rejects a non-gov.uk URL", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    await expect(
      uploadGuidance(ADMIN, PDF_FILE, { ...VALID_META, govukUrl: "https://example.com/doc" })
    ).rejects.toThrow(/gov\.uk/i);
  });

  it("rejects a file that is not PDF or HTML", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    // Buffer is random text — detectKind returns null and it doesn't look like HTML
    await expect(
      uploadGuidance(ADMIN, { ...PDF_FILE, buffer: Buffer.from("random binary content"), mimeType: "application/msword" }, VALID_META)
    ).rejects.toThrow(/PDF.*HTML|HTML.*PDF/i);
  });

  it("rejects a file flagged by the virus scanner", async () => {
    mockScan.mockResolvedValue({ clean: false, virus: "Eicar-Test" });
    const { uploadGuidance } = await import("@/lib/guidance");
    await expect(uploadGuidance(ADMIN, PDF_FILE, VALID_META)).rejects.toThrow(/virus/i);
  });

  it("stores the file and creates the DB record on success", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    await uploadGuidance(ADMIN, PDF_FILE, VALID_META);
    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("extracts text from HTML files and stores it", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    const htmlFile = {
      name: "guidance.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html><body><script>bad()</script><p>Guidance text</p></body></html>"),
    };
    await uploadGuidance(ADMIN, htmlFile, VALID_META);
    const createCall = mockCreate.mock.calls[0][0] as { data: { extractedText: string } };
    expect(createCall.data.extractedText).toContain("Guidance text");
    expect(createCall.data.extractedText).not.toContain("bad()");
  });

  it("stores null for extractedText on PDF files", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    await uploadGuidance(ADMIN, PDF_FILE, VALID_META);
    const createCall = mockCreate.mock.calls[0][0] as { data: { extractedText: null } };
    expect(createCall.data.extractedText).toBeNull();
  });

  it("rejects routeIds that do not belong to the firm", async () => {
    mockFindMany.mockResolvedValue([]); // no routes found
    const { uploadGuidance } = await import("@/lib/guidance");
    await expect(uploadGuidance(ADMIN, PDF_FILE, VALID_META)).rejects.toThrow(/route/i);
  });

  it("requires a title of at least 2 characters", async () => {
    const { uploadGuidance } = await import("@/lib/guidance");
    await expect(
      uploadGuidance(ADMIN, PDF_FILE, { ...VALID_META, title: "X" })
    ).rejects.toThrow(/2 character/i);
  });
});
