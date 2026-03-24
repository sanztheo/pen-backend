/**
 * AdminOpsController Tests
 * Covers: getAlerts, acknowledgeAlert, startImpersonation, endImpersonation
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// ─── Mock Redis to prevent real connections ─────────────────────
jest.mock("../../lib/redis.js", () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    scan: jest.fn().mockResolvedValue(["0", []]),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    on: jest.fn(),
    quit: jest.fn(),
  },
}));

// ─── Suppress logger output in tests ────────────────────────────
jest.mock("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Mock services ──────────────────────────────────────────────
const mockGetAlerts = jest.fn();
const mockAcknowledgeAlert = jest.fn();
jest.mock("../../services/admin/alertsService.js", () => ({
  AlertsService: {
    getAlerts: (...args: unknown[]) => mockGetAlerts(...args),
    acknowledgeAlert: (...args: unknown[]) => mockAcknowledgeAlert(...args),
  },
}));

const mockStartImpersonation = jest.fn();
const mockEndImpersonation = jest.fn();
jest.mock("../../services/admin/impersonationService.js", () => ({
  ImpersonationService: {
    startImpersonation: (...args: unknown[]) => mockStartImpersonation(...args),
    endImpersonation: (...args: unknown[]) => mockEndImpersonation(...args),
  },
}));

import { AdminOpsController } from "../adminOpsController.js";

// ─── Test Helpers ───────────────────────────────────────────────
interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

const createMockResponse = (): MockResponse => {
  const res: MockResponse = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const createMockRequest = (
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  userId = "admin-1",
): Partial<Request> => ({
  params,
  query,
  user: { id: userId, email: `${userId}@test.com` } as Request["user"],
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// getAlerts
// ═══════════════════════════════════════════════════════════════
describe("AdminOpsController.getAlerts", () => {
  it("returns alerts with default pagination", async () => {
    const alertData = {
      alerts: [{ id: "alert-1", type: "CHURN_SPIKE", acknowledged: false }],
      total: 1,
    };
    mockGetAlerts.mockResolvedValue(alertData);

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 50,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: alertData });
  });

  it("accepts valid alert type filter", async () => {
    mockGetAlerts.mockResolvedValue({ alerts: [], total: 0 });

    const req = createMockRequest({}, { type: "ERROR_RATE_HIGH" });
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ERROR_RATE_HIGH" }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects invalid alert type", async () => {
    const req = createMockRequest({}, { type: "INVALID_TYPE" });
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("type invalide"),
      }),
    );
  });

  it("passes acknowledged filter as boolean", async () => {
    mockGetAlerts.mockResolvedValue({ alerts: [], total: 0 });

    const req = createMockRequest({}, { acknowledged: "true" });
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(expect.objectContaining({ acknowledged: true }));
  });

  it("passes acknowledged false when set to 'false'", async () => {
    mockGetAlerts.mockResolvedValue({ alerts: [], total: 0 });

    const req = createMockRequest({}, { acknowledged: "false" });
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(expect.objectContaining({ acknowledged: false }));
  });

  it("omits acknowledged when not provided", async () => {
    mockGetAlerts.mockResolvedValue({ alerts: [], total: 0 });

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledged: undefined }),
    );
  });

  it("respects custom pagination params", async () => {
    mockGetAlerts.mockResolvedValue({ alerts: [], total: 0 });

    const req = createMockRequest({}, { page: "3", limit: "10" });
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(mockGetAlerts).toHaveBeenCalledWith(expect.objectContaining({ page: 3, limit: 10 }));
  });

  it("returns 500 on service error", async () => {
    mockGetAlerts.mockRejectedValue(new Error("DB down"));

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.getAlerts(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// acknowledgeAlert
// ═══════════════════════════════════════════════════════════════
describe("AdminOpsController.acknowledgeAlert", () => {
  it("acknowledges alert successfully", async () => {
    mockAcknowledgeAlert.mockResolvedValue({ success: true });

    const req = createMockRequest({ id: "alert-1" });
    const res = createMockResponse();

    await AdminOpsController.acknowledgeAlert(req as Request, res as unknown as Response);

    expect(mockAcknowledgeAlert).toHaveBeenCalledWith("alert-1", "admin-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "Alerte acquittée" }),
    );
  });

  it("returns 404 when alert not found", async () => {
    mockAcknowledgeAlert.mockResolvedValue({
      success: false,
      error: "Alerte non trouvée",
    });

    const req = createMockRequest({ id: "nonexistent" });
    const res = createMockResponse();

    await AdminOpsController.acknowledgeAlert(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Alerte non trouvée" }),
    );
  });

  it("rejects missing id param", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminOpsController.acknowledgeAlert(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "id requis" }),
    );
  });

  it("rejects overly long id param", async () => {
    const req = createMockRequest({ id: "x".repeat(256) });
    const res = createMockResponse();

    await AdminOpsController.acknowledgeAlert(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 on service error", async () => {
    mockAcknowledgeAlert.mockRejectedValue(new Error("fail"));

    const req = createMockRequest({ id: "alert-1" });
    const res = createMockResponse();

    await AdminOpsController.acknowledgeAlert(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// startImpersonation
// ═══════════════════════════════════════════════════════════════
describe("AdminOpsController.startImpersonation", () => {
  it("starts impersonation successfully", async () => {
    const result = { success: true, token: "imp-token-123", expiresAt: new Date() };
    mockStartImpersonation.mockResolvedValue(result);

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminOpsController.startImpersonation(req as Request, res as unknown as Response);

    expect(mockStartImpersonation).toHaveBeenCalledWith("admin-1", "user-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
  });

  it("returns 400 when service returns failure", async () => {
    mockStartImpersonation.mockResolvedValue({
      success: false,
      error: "User not found",
    });

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminOpsController.startImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "User not found" }),
    );
  });

  it("rejects missing userId param", async () => {
    const req = createMockRequest({});
    const res = createMockResponse();

    await AdminOpsController.startImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "userId requis" }),
    );
  });

  it("rejects overly long userId param", async () => {
    const req = createMockRequest({ userId: "x".repeat(256) });
    const res = createMockResponse();

    await AdminOpsController.startImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 on service error", async () => {
    mockStartImpersonation.mockRejectedValue(new Error("fail"));

    const req = createMockRequest({ userId: "user-1" });
    const res = createMockResponse();

    await AdminOpsController.startImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// endImpersonation
// ═══════════════════════════════════════════════════════════════
describe("AdminOpsController.endImpersonation", () => {
  it("ends impersonation successfully", async () => {
    mockEndImpersonation.mockResolvedValue({ success: true });

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.endImpersonation(req as Request, res as unknown as Response);

    expect(mockEndImpersonation).toHaveBeenCalledWith("admin-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Session d'impersonation terminée",
      }),
    );
  });

  it("returns 400 when service returns failure", async () => {
    mockEndImpersonation.mockResolvedValue({
      success: false,
      error: "No active session",
    });

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.endImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "No active session" }),
    );
  });

  it("returns 500 on service error", async () => {
    mockEndImpersonation.mockRejectedValue(new Error("fail"));

    const req = createMockRequest();
    const res = createMockResponse();

    await AdminOpsController.endImpersonation(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
