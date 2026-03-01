/**
 * HeartbeatController Unit Tests
 * Covers: auth guard, successful heartbeat, error handling
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { HeartbeatController } from "../heartbeatController.js";
import { BetaService } from "../../../services/BetaService.js";
import { redis } from "../../../lib/redis.js";

// ─── Mock BetaService ───────────────────────────────────────────
const mockRecordHeartbeat = jest.fn<typeof BetaService.recordHeartbeat>();
(BetaService as Record<string, unknown>).recordHeartbeat = mockRecordHeartbeat;

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
// HeartbeatController.recordHeartbeat
// ═══════════════════════════════════════════════════════════════
describe("HeartbeatController — recordHeartbeat", () => {
  it("should return 401 when user is not authenticated", async () => {
    const req = createMockRequest();
    const res = createMockResponse();

    await HeartbeatController.recordHeartbeat(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Authentication required",
      code: "MISSING_USER",
    });
    expect(mockRecordHeartbeat).not.toHaveBeenCalled();
  });

  it("should return 401 when req.user exists but has no id", async () => {
    const req: Partial<Request> = { user: {} as Request["user"] };
    const res = createMockResponse();

    await HeartbeatController.recordHeartbeat(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MISSING_USER" }));
  });

  it("should record heartbeat and return 200 for authenticated user", async () => {
    mockRecordHeartbeat.mockResolvedValue(undefined);

    const req = createMockRequest("user_456");
    const res = createMockResponse();

    await HeartbeatController.recordHeartbeat(req as Request, res as unknown as Response);

    expect(mockRecordHeartbeat).toHaveBeenCalledWith("user_456");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should return 500 when BetaService throws", async () => {
    mockRecordHeartbeat.mockRejectedValue(new Error("Redis timeout"));

    const req = createMockRequest("user_456");
    const res = createMockResponse();

    await HeartbeatController.recordHeartbeat(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Failed to record heartbeat",
    });
  });
});
