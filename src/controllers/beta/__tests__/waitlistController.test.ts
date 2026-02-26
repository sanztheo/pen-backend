/**
 * WaitlistController Security Tests
 * Covers: BM-001 (phone bypass), BM-002 (email enumeration), input validation
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { WaitlistController } from "../waitlistController.js";
import { BetaService } from "../../../services/BetaService.js";
import { redis } from "../../../lib/redis.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockAddToWaitlist = jest.fn();
(BetaService as any).addToWaitlist = mockAddToWaitlist;

// ─── Suppress logger output in tests ────────────────────────────
jest.unstable_mockModule("../../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Test Helpers ───────────────────────────────────────────────
interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

const createMockRequest = (
  body: Record<string, unknown> = {},
  userId?: string,
  userEmail?: string,
): Partial<Request> => ({
  body,
  user: userId
    ? ({
        id: userId,
        email: userEmail ?? `${userId}@test.com`,
      } as Request["user"])
    : undefined,
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// Input Validation
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — Input Validation", () => {
  it("should reject missing email", async () => {
    const req = createMockRequest({ name: "Test" });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_FIELDS" }));
  });

  it("should reject missing name", async () => {
    const req = createMockRequest({ email: "test@example.com" });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_FIELDS" }));
  });

  it("should reject invalid email format", async () => {
    const req = createMockRequest({
      email: "not-an-email",
      name: "Test User",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_EMAIL" }));
  });

  it("should reject name shorter than 2 characters", async () => {
    const req = createMockRequest({ email: "t@e.com", name: "A" });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_NAME_LENGTH" }));
  });

  it("should reject name longer than 200 characters", async () => {
    const req = createMockRequest({
      email: "t@e.com",
      name: "A".repeat(201),
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_NAME_LENGTH" }));
  });

  it("should normalize email to lowercase and trim", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 1,
      alreadyExists: false,
      rejected: false,
    });

    const req = createMockRequest({
      email: "  Test@Example.COM  ",
      name: "Test",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(mockAddToWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test@example.com" }),
      undefined,
    );
  });

  it("should handle non-object request body gracefully", async () => {
    const req = {
      body: "not-an-object",
      user: undefined,
    } as unknown as Request;
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_FIELDS" }));
  });
});

// ═══════════════════════════════════════════════════════════════
// BM-001: Phone field bypass metadata 4KB limit
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — BM-001: Phone bypass prevention", () => {
  it("should reject phone longer than 32 characters", async () => {
    const req = createMockRequest({
      email: "test@example.com",
      name: "Test User",
      phone: "+1234567890123456789012345678901234",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_PHONE" }));
  });

  it("should reject phone with non-phone characters", async () => {
    const req = createMockRequest({
      email: "test@example.com",
      name: "Test User",
      phone: "<script>alert(1)</script>",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_PHONE" }));
  });

  it("should accept valid phone formats", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 1,
      alreadyExists: false,
      rejected: false,
    });

    const validPhones = ["+33 6 12 34 56 78", "(555) 123-4567", "0612345678"];

    for (const phone of validPhones) {
      jest.clearAllMocks();
      mockAddToWaitlist.mockResolvedValue({
        position: 1,
        alreadyExists: false,
        rejected: false,
      });

      const req = createMockRequest({
        email: "test@example.com",
        name: "Test User",
        phone,
      });
      const res = createMockResponse();

      await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(201);
    }
  });

  it("should reject combined metadata+phone exceeding 4KB", async () => {
    // metadata near 4KB + valid phone = exceeds limit
    const largeMetadata: Record<string, string> = {};
    // Fill metadata to ~3900 bytes
    for (let i = 0; i < 50; i++) {
      largeMetadata[`field_${i}`] = "x".repeat(70);
    }

    const req = createMockRequest({
      email: "test@example.com",
      name: "Test User",
      phone: "+33 6 12 34 56 78",
      metadata: largeMetadata,
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "METADATA_TOO_LARGE" }));
  });

  it("should include phone in final metadata sent to service", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 1,
      alreadyExists: false,
      rejected: false,
    });

    const req = createMockRequest({
      email: "test@example.com",
      name: "Test User",
      phone: "+33612345678",
      metadata: { source: "website" },
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(mockAddToWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { source: "website", phone: "+33612345678" },
      }),
      undefined,
    );
  });

  it("should not include phone key when phone is empty", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 1,
      alreadyExists: false,
      rejected: false,
    });

    const req = createMockRequest({
      email: "test@example.com",
      name: "Test User",
      phone: "",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    const calledMetadata = mockAddToWaitlist.mock.calls[0]?.[0]?.metadata;
    expect(calledMetadata).not.toHaveProperty("phone");
  });
});

// ═══════════════════════════════════════════════════════════════
// BM-002: Email enumeration prevention
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — BM-002: Email enumeration prevention", () => {
  it("should return 201 for new entry (unauthenticated)", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 5,
      alreadyExists: false,
      rejected: false,
    });

    const req = createMockRequest({
      email: "new@example.com",
      name: "New User",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should return 201 for duplicate entry (unauthenticated) — SAME response shape", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 3,
      alreadyExists: true,
      rejected: false,
    });

    const req = createMockRequest({
      email: "existing@example.com",
      name: "Existing User",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    // CRITICAL: must be 201, NOT 409
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should have indistinguishable responses for new vs duplicate (unauthenticated)", async () => {
    // New entry
    mockAddToWaitlist.mockResolvedValue({
      position: 5,
      alreadyExists: false,
      rejected: false,
    });

    const reqNew = createMockRequest({
      email: "new@test.com",
      name: "New",
    });
    const resNew = createMockResponse();
    await WaitlistController.addToWaitlist(reqNew as Request, resNew as unknown as Response);

    // Capture response before clearing mocks
    const newStatus = resNew.status.mock.calls[0]?.[0];
    const newResponse = resNew.json.mock.calls[0]?.[0];

    // Duplicate entry
    mockAddToWaitlist.mockResolvedValue({
      position: 3,
      alreadyExists: true,
      rejected: false,
    });

    const reqDup = createMockRequest({
      email: "dup@test.com",
      name: "Dup",
    });
    const resDup = createMockResponse();
    await WaitlistController.addToWaitlist(reqDup as Request, resDup as unknown as Response);

    const dupStatus = resDup.status.mock.calls[0]?.[0];
    const dupResponse = resDup.json.mock.calls[0]?.[0];

    // CRITICAL: both responses must be identical in shape and status
    expect(newStatus).toBe(201);
    expect(dupStatus).toBe(201);
    expect(Object.keys(newResponse as Record<string, unknown>).sort()).toEqual(
      Object.keys(dupResponse as Record<string, unknown>).sort(),
    );
  });

  it("should NOT expose position to unauthenticated users", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 42,
      alreadyExists: false,
      rejected: false,
    });

    const req = createMockRequest({
      email: "anon@test.com",
      name: "Anonymous",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    const response = res.json.mock.calls[0]?.[0];
    expect(response).not.toHaveProperty("position");
  });

  it("should expose position to authenticated users", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 42,
      alreadyExists: false,
      rejected: false,
      isOwned: true,
    });

    const req = createMockRequest({ email: "auth@test.com", name: "Auth User" }, "user-123");
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    const response = res.json.mock.calls[0]?.[0];
    expect(response.position).toBe(42);
  });

  it("should expose position to authenticated users even for duplicates", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 7,
      alreadyExists: true,
      rejected: false,
      isOwned: true,
    });

    const req = createMockRequest({ email: "dup@test.com", name: "Dup User" }, "user-456");
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(201);
    const response = res.json.mock.calls[0]?.[0];
    expect(response.position).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════
// Active user rejection (indistinguishable — BM-002)
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — Active user guard", () => {
  it("should return indistinguishable 201 for rejected active users (authenticated)", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 0,
      alreadyExists: false,
      rejected: true,
    });

    const req = createMockRequest({ email: "active@test.com", name: "Active" }, "active-user");
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    // BM-002: must be 201 { success: true } — indistinguishable from normal success
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should return indistinguishable 201 for rejected active users (unauthenticated)", async () => {
    mockAddToWaitlist.mockResolvedValue({
      position: 0,
      alreadyExists: false,
      rejected: true,
    });

    const req = createMockRequest({
      email: "active-public@test.com",
      name: "Active Public",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    // BM-002: unauthenticated rejected must also be 201 — no email enumeration
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should have identical response shape for rejected vs new entry (unauthenticated)", async () => {
    // Rejected (active user email submitted publicly)
    mockAddToWaitlist.mockResolvedValue({
      position: 0,
      alreadyExists: false,
      rejected: true,
    });

    const reqRejected = createMockRequest({
      email: "active@test.com",
      name: "Active",
    });
    const resRejected = createMockResponse();
    await WaitlistController.addToWaitlist(
      reqRejected as Request,
      resRejected as unknown as Response,
    );

    const rejectedStatus = resRejected.status.mock.calls[0]?.[0];
    const rejectedBody = resRejected.json.mock.calls[0]?.[0];

    // New entry (normal success)
    mockAddToWaitlist.mockResolvedValue({
      position: 5,
      alreadyExists: false,
      rejected: false,
    });

    const reqNew = createMockRequest({
      email: "new@test.com",
      name: "New",
    });
    const resNew = createMockResponse();
    await WaitlistController.addToWaitlist(reqNew as Request, resNew as unknown as Response);

    const newStatus = resNew.status.mock.calls[0]?.[0];
    const newBody = resNew.json.mock.calls[0]?.[0];

    // CRITICAL: both must be identical — no enumeration signal
    expect(rejectedStatus).toBe(newStatus);
    expect(Object.keys(rejectedBody as Record<string, unknown>).sort()).toEqual(
      Object.keys(newBody as Record<string, unknown>).sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// MISSING_USER_EMAIL guard
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — MISSING_USER_EMAIL guard", () => {
  it("should reject authenticated user with no email", async () => {
    const req = createMockRequest(
      { email: "test@example.com", name: "No Email User" },
      "user-no-email",
      "",
    );
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_USER_EMAIL" }));
    expect(mockAddToWaitlist).not.toHaveBeenCalled();
  });

  it("should reject authenticated user with undefined email", async () => {
    const req: Partial<Request> = {
      body: { email: "test@example.com", name: "Undefined Email" },
      user: { id: "user-undef-email" } as Request["user"],
    };
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_USER_EMAIL" }));
    expect(mockAddToWaitlist).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════
describe("WaitlistController — Error handling", () => {
  it("should return 500 on unexpected service errors", async () => {
    mockAddToWaitlist.mockRejectedValue(new Error("DB exploded"));

    const req = createMockRequest({
      email: "err@test.com",
      name: "Error Test",
    });
    const res = createMockResponse();

    await WaitlistController.addToWaitlist(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to add to waitlist" }),
    );
  });
});
