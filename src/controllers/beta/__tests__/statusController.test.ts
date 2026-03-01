/**
 * StatusController Unit Tests
 * Covers: authenticated/unauthenticated status fetch, error handling
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { StatusController } from "../statusController.js";
import { BetaService } from "../../../services/BetaService.js";
import { redis } from "../../../lib/redis.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockGetStatus = jest.fn<typeof BetaService.getStatus>();
(BetaService as Record<string, unknown>).getStatus = mockGetStatus;

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
// StatusController.getStatus
// ═══════════════════════════════════════════════════════════════
describe("StatusController — getStatus", () => {
  it("should return status for authenticated user", async () => {
    const statusData = {
      spotsRemaining: 10,
      totalSpots: 50,
      userStatus: "active" as const,
      progress: { create_page: true, write_content: false, use_ai: false, generate_quiz: false },
    };
    mockGetStatus.mockResolvedValue(statusData);

    const req = createMockRequest("user_123");
    const res = createMockResponse();

    await StatusController.getStatus(req as Request, res as unknown as Response);

    expect(mockGetStatus).toHaveBeenCalledWith("user_123");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: statusData });
  });

  it("should return status without userId for unauthenticated user", async () => {
    const statusData = { spotsRemaining: 10, totalSpots: 50 };
    mockGetStatus.mockResolvedValue(statusData);

    const req = createMockRequest();
    const res = createMockResponse();

    await StatusController.getStatus(req as Request, res as unknown as Response);

    expect(mockGetStatus).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: statusData });
  });

  it("should return 500 when BetaService throws", async () => {
    mockGetStatus.mockRejectedValue(new Error("DB connection failed"));

    const req = createMockRequest("user_123");
    const res = createMockResponse();

    await StatusController.getStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Failed to fetch beta status",
    });
  });

  it("should pass undefined when req.user exists but has no id", async () => {
    mockGetStatus.mockResolvedValue({ spotsRemaining: 5, totalSpots: 50 });

    const req: Partial<Request> = { user: {} as Request["user"] };
    const res = createMockResponse();

    await StatusController.getStatus(req as Request, res as unknown as Response);

    expect(mockGetStatus).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
