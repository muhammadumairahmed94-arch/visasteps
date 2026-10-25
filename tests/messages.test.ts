import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.AUTH_SECRET ??= "test-auth-secret-must-be-32-chars-xxxx";

// ── hoisted mocks (must be declared before any static import) ──────────────
const mocks = vi.hoisted(() => ({
  message: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  client: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  rateLimit: { deleteMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: mocks.message,
    client: mocks.client,
    rateLimit: mocks.rateLimit,
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  hit: vi.fn().mockResolvedValue(true),
  limit: vi.fn().mockResolvedValue(undefined),
  RateLimited: class extends Error { constructor() { super("Too many attempts. Please wait a few minutes and try again."); } },
}));

vi.mock("@/lib/adapters/email", () => ({
  sendSafely: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  auditView: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  currentClient: vi.fn(),
  currentStaff: vi.fn(),
  requestIp: vi.fn().mockResolvedValue("1.2.3.4"),
}));

vi.mock("@/lib/http", async (orig) => {
  const actual = await orig<typeof import("@/lib/http")>();
  return { ...actual, sameOrigin: () => true };
});

// ── static imports (after vi.mock) ────────────────────────────────────────
import { sendMessage, listMessages, markRead, MAX_MSG_LEN } from "../lib/messages";
import { encrypt, decrypt } from "../lib/crypto";
import { GET as clientMessagesGET, POST as clientMessagesPOST } from "../app/api/client/messages/route";
import { GET as staffMessagesGET, POST as staffMessagesPOST } from "../app/api/staff/messages/[clientId]/route";
import { hit, limit } from "@/lib/ratelimit";
import { sendSafely } from "@/lib/adapters/email";
import { audit } from "@/lib/audit";
import { currentClient, currentStaff } from "@/lib/auth";

// ── helpers ────────────────────────────────────────────────────────────────
const makeClient = (overrides?: object) => ({
  id: "c1", firmId: "f1", email: "client@example.com",
  firstName: "Ali", lastName: "Khan", closedAt: null, caseRef: "UHA-001",
  caseworker: { id: "cw1", name: "Sara", email: "sara@example.com" },
  firm: { name: "UHA Legal" },
  caseworkerId: "cw1",
  ...overrides,
});

const makeUser = (overrides?: object) => ({
  id: "cw1", firmId: "f1", name: "Sara", email: "sara@example.com",
  role: "CASEWORKER" as "CASEWORKER" | "ADMIN",
  ...overrides,
});

const enc = (s: string) => encrypt(s, "message");

function makeRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/", {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeCtx(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hit).mockResolvedValue(true);
});

// ── sendMessage ────────────────────────────────────────────────────────────
describe("sendMessage", () => {
  it("stores the body encrypted, not as plaintext", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    const storedBody = enc("hello");
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: storedBody,
      createdAt: new Date(), readAt: null, staff: null,
    });

    await sendMessage("c1", { kind: "CLIENT" }, "hello");

    const createCall = mocks.message.create.mock.calls[0][0] as { data: { body: string } };
    expect(createCall.data.body).not.toBe("hello");
    expect(decrypt(createCall.data.body, "message")).toBe("hello");
  });

  it("trims and truncates text to MAX_MSG_LEN", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    const long = "x".repeat(MAX_MSG_LEN + 100);
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc(long.slice(0, MAX_MSG_LEN)),
      createdAt: new Date(), readAt: null, staff: null,
    });

    const result = await sendMessage("c1", { kind: "CLIENT" }, long);
    expect(result.body).toHaveLength(MAX_MSG_LEN);
  });

  it("rejects empty text", async () => {
    mocks.client.findUnique.mockResolvedValue(makeClient());
    await expect(sendMessage("c1", { kind: "CLIENT" }, "   ")).rejects.toThrow("Please write a message.");
  });

  it("rejects send when case is closed", async () => {
    mocks.client.findUnique.mockResolvedValue(makeClient({ closedAt: new Date() }));
    await expect(sendMessage("c1", { kind: "CLIENT" }, "hi")).rejects.toThrow("This case is closed");
  });

  it("notifies caseworker when client sends (hit returns true)", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: null,
    });

    await sendMessage("c1", { kind: "CLIENT" }, "hi");

    expect(sendSafely).toHaveBeenCalledWith(expect.objectContaining({
      to: "sara@example.com",
    }));
    const emailArg = vi.mocked(sendSafely).mock.calls[0][0];
    expect(emailArg.text).not.toContain("hi");
    expect(emailArg.subject).not.toContain("hi");
  });

  it("skips notification when rate limit is already hit", async () => {
    vi.mocked(hit).mockResolvedValue(false);
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: null,
    });

    await sendMessage("c1", { kind: "CLIENT" }, "hi");

    expect(sendSafely).not.toHaveBeenCalled();
  });

  it("writes audit log on send", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: null,
    });

    await sendMessage("c1", { kind: "CLIENT" }, "hi");

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "message.send" }));
  });

  it("returns the actual sender's name, not the assigned caseworker's name", async () => {
    // Admin (different from the assigned caseworker) sends a message.
    const client = makeClient({ caseworker: { id: "cw1", name: "Sara", email: "sara@example.com" } });
    mocks.client.findUnique.mockResolvedValue(client);
    const admin = makeUser({ id: "admin1", name: "Admin User", role: "ADMIN" as never }) as never;
    mocks.message.create.mockResolvedValue({
      id: "m3", senderKind: "STAFF", staffId: "admin1", body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: { name: "Admin User" },
    });

    const result = await sendMessage("c1", { kind: "STAFF", user: admin }, "hi");

    expect(result.senderName).toBe("Admin User");
  });

  it("notifies client when staff sends", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue(client);
    const user = makeUser() as never;
    const msgBody = "xUniqueMsgBody9382";
    mocks.message.create.mockResolvedValue({
      id: "m2", senderKind: "STAFF", staffId: "cw1", body: enc(msgBody),
      createdAt: new Date(), readAt: null, staff: { name: "Sara" },
    });

    await sendMessage("c1", { kind: "STAFF", user }, msgBody);

    expect(sendSafely).toHaveBeenCalledWith(expect.objectContaining({
      to: "client@example.com",
    }));
    const emailArg = vi.mocked(sendSafely).mock.calls[0][0];
    expect(emailArg.text).not.toContain(msgBody);
  });
});

// ── listMessages ──────────────────────────────────────────────────────────
describe("listMessages", () => {
  it("decrypts message bodies before returning", async () => {
    const client = makeClient();
    mocks.client.findUnique.mockResolvedValue({
      ...client,
      messages: [
        { id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hello from client"),
          createdAt: new Date(), readAt: null, staff: null },
      ],
    });

    const { messages } = await listMessages("c1");
    expect(messages[0].body).toBe("hello from client");
  });

  it("never returns the raw encrypted body", async () => {
    const ciphertext = enc("secret");
    mocks.client.findUnique.mockResolvedValue({
      ...makeClient(),
      messages: [
        { id: "m1", senderKind: "STAFF", staffId: "cw1", body: ciphertext,
          createdAt: new Date(), readAt: null, staff: { name: "Sara" } },
      ],
    });

    const { messages } = await listMessages("c1");
    expect(messages[0].body).not.toBe(ciphertext);
    expect(messages[0].body).toBe("secret");
  });

  it("reports closed status from the client record", async () => {
    mocks.client.findUnique.mockResolvedValue({ ...makeClient({ closedAt: new Date() }), messages: [] });
    const result = await listMessages("c1");
    expect(result.closed).toBe(true);
  });
});

// ── markRead ──────────────────────────────────────────────────────────────
describe("markRead", () => {
  it("CLIENT read marks STAFF messages as read", async () => {
    await markRead("c1", "CLIENT");
    expect(mocks.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ senderKind: "STAFF", readAt: null }),
    }));
  });

  it("STAFF read by assigned caseworker marks CLIENT messages as read", async () => {
    mocks.client.findUnique.mockResolvedValue({ caseworkerId: "cw1" });
    await markRead("c1", "STAFF", "cw1");
    expect(mocks.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ senderKind: "CLIENT", readAt: null }),
    }));
  });

  it("admin (non-assigned staff) opening thread does NOT mark messages as read", async () => {
    mocks.client.findUnique.mockResolvedValue({ caseworkerId: "cw1" });
    await markRead("c1", "STAFF", "admin1");
    expect(mocks.message.updateMany).not.toHaveBeenCalled();
  });

  it("STAFF read without staffId is a no-op", async () => {
    await markRead("c1", "STAFF");
    expect(mocks.message.updateMany).not.toHaveBeenCalled();
  });

  it("CLIENT read deletes messageNotifyClient rate limit so next message notifies", async () => {
    await markRead("c1", "CLIENT");
    expect(mocks.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: "messageNotifyClient:c1" } });
  });

  it("STAFF read by caseworker deletes messageNotifyStaff rate limit", async () => {
    mocks.client.findUnique.mockResolvedValue({ caseworkerId: "cw1" });
    await markRead("c1", "STAFF", "cw1");
    expect(mocks.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: "messageNotifyStaff:cw:c1" } });
  });
});

// ── GET /api/client/messages ───────────────────────────────────────────────
describe("GET /api/client/messages", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(currentClient).mockResolvedValue(null);
    const res = await clientMessagesGET(makeRequest("GET"));
    expect(res.status).toBe(401);
  });

  it("returns messages for signed-in client (their own only)", async () => {
    vi.mocked(currentClient).mockResolvedValue(makeClient() as never);
    mocks.client.findUnique.mockResolvedValue({
      ...makeClient(),
      messages: [
        { id: "m1", senderKind: "STAFF", staffId: "cw1", body: enc("Hi there"),
          createdAt: new Date("2026-01-01"), readAt: null, staff: { name: "Sara" } },
      ],
    });

    const res = await clientMessagesGET(makeRequest("GET"));
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: { body: string }[] };
    expect(data.messages[0].body).toBe("Hi there");
  });
});

// ── POST /api/client/messages ──────────────────────────────────────────────
describe("POST /api/client/messages", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(currentClient).mockResolvedValue(null);
    const res = await clientMessagesPOST(makeRequest("POST", { text: "hello" }));
    expect(res.status).toBe(401);
  });

  it("calls limit(messageClient, clientId)", async () => {
    vi.mocked(currentClient).mockResolvedValue(makeClient() as never);
    mocks.client.findUnique.mockResolvedValue(makeClient());
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hello"),
      createdAt: new Date(), readAt: null, staff: null,
    });

    await clientMessagesPOST(makeRequest("POST", { text: "hello" }));
    expect(limit).toHaveBeenCalledWith("messageClient", "c1");
  });

  it("returns 400 when text is missing", async () => {
    vi.mocked(currentClient).mockResolvedValue(makeClient() as never);
    const res = await clientMessagesPOST(makeRequest("POST", { text: 42 }));
    expect(res.status).toBe(400);
  });

  it("creates the message and returns 201", async () => {
    vi.mocked(currentClient).mockResolvedValue(makeClient() as never);
    mocks.client.findUnique.mockResolvedValue(makeClient());
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "CLIENT", staffId: null, body: enc("hello"),
      createdAt: new Date(), readAt: null, staff: null,
    });

    const res = await clientMessagesPOST(makeRequest("POST", { text: "hello" }));
    expect(res.status).toBe(201);
  });
});

// ── GET /api/staff/messages/[clientId] ────────────────────────────────────
describe("GET /api/staff/messages/[clientId]", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(currentStaff).mockResolvedValue(null);
    const res = await staffMessagesGET(makeRequest("GET"), makeCtx("c1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when caseworker is not assigned to client", async () => {
    vi.mocked(currentStaff).mockResolvedValue(makeUser() as never);
    mocks.client.findFirst.mockResolvedValue(null); // visibleCases filtered it out
    const res = await staffMessagesGET(makeRequest("GET"), makeCtx("c1"));
    expect(res.status).toBe(404);
  });

  it("returns messages when caseworker is assigned", async () => {
    vi.mocked(currentStaff).mockResolvedValue(makeUser() as never);
    mocks.client.findFirst.mockResolvedValue(makeClient());
    mocks.client.findUnique.mockResolvedValue({
      ...makeClient(),
      messages: [
        { id: "m1", senderKind: "CLIENT", staffId: null, body: enc("question"),
          createdAt: new Date("2026-01-01"), readAt: null, staff: null },
      ],
    });

    const res = await staffMessagesGET(makeRequest("GET"), makeCtx("c1"));
    expect(res.status).toBe(200);
    const data = await res.json() as { messages: { body: string }[] };
    expect(data.messages[0].body).toBe("question");
  });

  it("admin can read messages for any visible client", async () => {
    const admin = makeUser({ id: "admin1", role: "ADMIN" as const });
    vi.mocked(currentStaff).mockResolvedValue(admin as never);
    mocks.client.findFirst.mockResolvedValue(makeClient());
    mocks.client.findUnique.mockResolvedValue({
      ...makeClient(),
      messages: [],
    });

    const res = await staffMessagesGET(makeRequest("GET"), makeCtx("c1"));
    expect(res.status).toBe(200);
  });

  it("admin view does NOT mark messages as read (caseworker check inside markRead)", async () => {
    const admin = makeUser({ id: "admin1", role: "ADMIN" as const });
    vi.mocked(currentStaff).mockResolvedValue(admin as never);
    mocks.client.findFirst.mockResolvedValue(makeClient()); // admin can find client
    mocks.client.findUnique
      .mockResolvedValueOnce({ ...makeClient(), messages: [] }) // listMessages
      .mockResolvedValueOnce({ caseworkerId: "cw1" });          // markRead check

    await staffMessagesGET(makeRequest("GET"), makeCtx("c1"));
    // updateMany should not be called because admin1 !== cw1
    expect(mocks.message.updateMany).not.toHaveBeenCalled();
  });
});

// ── POST /api/staff/messages/[clientId] ───────────────────────────────────
describe("POST /api/staff/messages/[clientId]", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(currentStaff).mockResolvedValue(null);
    const res = await staffMessagesPOST(makeRequest("POST", { text: "hi" }), makeCtx("c1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-visible client", async () => {
    vi.mocked(currentStaff).mockResolvedValue(makeUser() as never);
    mocks.client.findFirst.mockResolvedValue(null);
    const res = await staffMessagesPOST(makeRequest("POST", { text: "hi" }), makeCtx("c1"));
    expect(res.status).toBe(404);
  });

  it("calls limit(messageStaff, userId)", async () => {
    vi.mocked(currentStaff).mockResolvedValue(makeUser() as never);
    mocks.client.findFirst.mockResolvedValue(makeClient());
    mocks.client.findUnique.mockResolvedValue(makeClient());
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "STAFF", staffId: "cw1", body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: { name: "Sara" },
    });

    await staffMessagesPOST(makeRequest("POST", { text: "hi" }), makeCtx("c1"));
    expect(limit).toHaveBeenCalledWith("messageStaff", "cw1");
  });

  it("creates message and returns 201", async () => {
    vi.mocked(currentStaff).mockResolvedValue(makeUser() as never);
    mocks.client.findFirst.mockResolvedValue(makeClient());
    mocks.client.findUnique.mockResolvedValue(makeClient());
    mocks.message.create.mockResolvedValue({
      id: "m1", senderKind: "STAFF", staffId: "cw1", body: enc("hi"),
      createdAt: new Date(), readAt: null, staff: { name: "Sara" },
    });

    const res = await staffMessagesPOST(makeRequest("POST", { text: "hi" }), makeCtx("c1"));
    expect(res.status).toBe(201);
  });
});
