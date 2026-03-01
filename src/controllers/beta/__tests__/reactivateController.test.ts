/**
 * ReactivateController Unit Tests
 * Covers: auth guard, success, no-spots (403), other errors (400), server error (500)
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { ReactivateController } from "../reactivateController.js";
import { BetaService } from "../../../services/BetaService.js";
import { redis } from "../../../lib/redis.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockReactivateUser = jest.fn();
(BetaService as Record<string, unknown>).reactivateUser = mockReactivateUser;

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

function createMockResponse(): MockResponse {
  const res: MockResponse = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function createMockRequest(userId?: string): Partial<Request> {
  return {
    user: userId ? ({ id: userId, email: `${userId}@test.com` } as Request["user"]) : undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// ReactivateController.reactivate
// ═══════════════════════════════════════════════════════════════
describe("ReactivateController — reactivate", () => {
  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest();
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Authentication required",
      code: "MISSING_USER",
    });
    expect(mockReactivateUser).not.toHaveBeenCalled();
  });

  it("should return 401 when req.user exists but has no id", async () => {
    const req: Partial<Request> = { user: {} as Request["user"] };
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_USER" }));
  });

  it("should return 200 when reactivation succeeds", async () => {
    mockReactivateUser.mockResolvedValue({ success: true });

    const req = createMockRequest("user_789");
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(mockReactivateUser).toHaveBeenCalledWith("user_789");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should return 403 when no spots are available", async () => {
    mockReactivateUser.mockResolvedValue({
      success: false,
      error: "No beta spots available",
      code: "NO_SPOTS_AVAILABLE",
    });

    const req = createMockRequest("user_789");
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "No beta spots available",
      code: "NO_SPOTS_AVAILABLE",
    });
  });

  it("should return 400 for non-spot-related failure", async () => {
    mockReactivateUser.mockResolvedValue({
      success: false,
      error: "User is not in inactive status",
      code: "INVALID_STATUS",
    });

    const req = createMockRequest("user_789");
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "User is not in inactive status",
      code: "INVALID_STATUS",
    });
  });

  it("should return 500 when BetaService throws an exception", async () => {
    mockReactivateUser.mockRejectedValue(new Error("Transaction deadlock"));

    const req = createMockRequest("user_789");
    const res = createMockResponse();

    await ReactivateController.reactivate(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Failed to reactivate account",
    });
  });

  it("should differentiate 403 (NO_SPOTS_AVAILABLE) from 400 (other codes)", async () => {
    const scenarios = [
      { code: "NO_SPOTS_AVAILABLE", expectedStatus: 403 },
      { code: "INVALID_STATUS", expectedStatus: 400 },
      { code: "USER_NOT_FOUND", expectedStatus: 400 },
      { code: "ALREADY_ACTIVE", expectedStatus: 400 },
    ];

    for (const { code, expectedStatus } of scenarios) {
      jest.clearAllMocks();
      mockReactivateUser.mockResolvedValue({
        success: false,
        error: `Error for ${code}`,
        code,
      });

      const req = createMockRequest("user_test");
      const res = createMockResponse();

      await ReactivateController.reactivate(req as Request, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(expectedStatus);
    }
  });
});
