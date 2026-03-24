/**
 * AdminDashboardController Tests
 * Covers: checkAdminStatus, getHealthStatus, getDashboard,
 *         getUserMetrics, getRevenueMetrics, getUsageMetrics,
 *         getTrendsMetrics, getAICosts, getRetentionCohorts, getLtvMetrics
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
const mockGetHealthStatus = jest.fn();
jest.mock("../../services/admin/healthCheckService.js", () => ({
  HealthCheckService: { getHealthStatus: (...args: unknown[]) => mockGetHealthStatus(...args) },
}));

const mockGetDashboardMetrics = jest.fn();
const mockGetUserMetrics = jest.fn();
const mockGetRevenueMetrics = jest.fn();
const mockGetUsageMetrics = jest.fn();
jest.mock("../../services/admin/adminStatsService.js", () => ({
  AdminStatsService: {
    getDashboardMetrics: (...args: unknown[]) => mockGetDashboardMetrics(...args),
    getUserMetrics: (...args: unknown[]) => mockGetUserMetrics(...args),
    getRevenueMetrics: (...args: unknown[]) => mockGetRevenueMetrics(...args),
    getUsageMetrics: (...args: unknown[]) => mockGetUsageMetrics(...args),
  },
}));

const mockGetTrends = jest.fn();
jest.mock("../../services/admin/trendsMetricsService.js", () => ({
  TrendsMetricsService: { getTrends: (...args: unknown[]) => mockGetTrends(...args) },
}));

const mockGetCohorts = jest.fn();
jest.mock("../../services/admin/retentionCohortService.js", () => ({
  RetentionCohortService: { getCohorts: (...args: unknown[]) => mockGetCohorts(...args) },
}));

const mockGetLtvMetrics = jest.fn();
jest.mock("../../services/admin/ltvService.js", () => ({
  LtvService: { getLtvMetrics: (...args: unknown[]) => mockGetLtvMetrics(...args) },
}));

const mockGetAICosts = jest.fn();
jest.mock("../../services/admin/aiCostService.js", () => ({
  AICostService: { getAICosts: (...args: unknown[]) => mockGetAICosts(...args) },
}));

import { AdminDashboardController } from "../adminDashboardController.js";

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
  query: Record<string, string> = {},
  user: { id: string; email: string; isAdmin?: boolean } = {
    id: "admin-1",
    email: "admin@test.com",
    isAdmin: true,
  },
): Partial<Request> => ({
  params: {},
  query,
  user: user as Request["user"],
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// checkAdminStatus
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.checkAdminStatus", () => {
  it("returns isAdmin true when user is admin", async () => {
    const req = createMockRequest({}, { id: "admin-1", email: "a@t.com", isAdmin: true });
    const res = createMockResponse();

    await AdminDashboardController.checkAdminStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { isAdmin: true },
    });
  });

  it("returns isAdmin false when isAdmin is not set", async () => {
    const req = createMockRequest({}, { id: "user-1", email: "u@t.com" });
    const res = createMockResponse();

    await AdminDashboardController.checkAdminStatus(req as Request, res as unknown as Response);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { isAdmin: false },
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// getHealthStatus
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getHealthStatus", () => {
  it("returns health data on success", async () => {
    const healthData = { database: "ok", redis: "ok" };
    mockGetHealthStatus.mockResolvedValue(healthData);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getHealthStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: healthData });
  });

  it("returns 500 on service error", async () => {
    mockGetHealthStatus.mockRejectedValue(new Error("DB down"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getHealthStatus(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getDashboard
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getDashboard", () => {
  it("returns dashboard metrics", async () => {
    const metrics = { totalUsers: 100, activeUsers: 50 };
    mockGetDashboardMetrics.mockResolvedValue(metrics);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getDashboard(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: metrics });
  });

  it("returns 500 on error", async () => {
    mockGetDashboardMetrics.mockRejectedValue(new Error("fail"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getDashboard(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getUserMetrics
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getUserMetrics", () => {
  it("returns user metrics", async () => {
    const metrics = { newUsers: 10, activeUsers: 50 };
    mockGetUserMetrics.mockResolvedValue(metrics);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getUserMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: metrics });
  });

  it("returns 500 on error", async () => {
    mockGetUserMetrics.mockRejectedValue(new Error("fail"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getUserMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getRevenueMetrics
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getRevenueMetrics", () => {
  it("returns revenue metrics", async () => {
    const metrics = { mrr: 5000, arr: 60000 };
    mockGetRevenueMetrics.mockResolvedValue(metrics);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getRevenueMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: metrics });
  });

  it("returns 500 on error", async () => {
    mockGetRevenueMetrics.mockRejectedValue(new Error("fail"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getRevenueMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getUsageMetrics
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getUsageMetrics", () => {
  it("returns usage metrics", async () => {
    const metrics = { totalQuizzes: 200, totalChats: 500 };
    mockGetUsageMetrics.mockResolvedValue(metrics);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getUsageMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: metrics });
  });

  it("returns 500 on error", async () => {
    mockGetUsageMetrics.mockRejectedValue(new Error("fail"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getUsageMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ═══════════════════════════════════════════════════════════════
// getTrendsMetrics
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getTrendsMetrics", () => {
  it("defaults to 30d period", async () => {
    const data = [{ date: "2026-01-01", active: 10 }];
    mockGetTrends.mockResolvedValue(data);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getTrendsMetrics(req as Request, res as unknown as Response);

    expect(mockGetTrends).toHaveBeenCalledWith("30d");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("accepts valid period 7d", async () => {
    mockGetTrends.mockResolvedValue([]);
    const req = createMockRequest({ period: "7d" });
    const res = createMockResponse();

    await AdminDashboardController.getTrendsMetrics(req as Request, res as unknown as Response);

    expect(mockGetTrends).toHaveBeenCalledWith("7d");
  });

  it("rejects invalid period", async () => {
    const req = createMockRequest({ period: "invalid" });
    const res = createMockResponse();

    await AdminDashboardController.getTrendsMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("returns 500 on service error", async () => {
    mockGetTrends.mockRejectedValue(new Error("fail"));
    const req = createMockRequest({ period: "30d" });
    const res = createMockResponse();

    await AdminDashboardController.getTrendsMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// getAICosts
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getAICosts", () => {
  it("returns AI cost data", async () => {
    const data = { totalCost: 42.5 };
    mockGetAICosts.mockResolvedValue(data);
    const req = createMockRequest({ period: "90d" });
    const res = createMockResponse();

    await AdminDashboardController.getAICosts(req as Request, res as unknown as Response);

    expect(mockGetAICosts).toHaveBeenCalledWith("90d");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it("rejects invalid period", async () => {
    const req = createMockRequest({ period: "1y" });
    const res = createMockResponse();

    await AdminDashboardController.getAICosts(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// getRetentionCohorts
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getRetentionCohorts", () => {
  it("defaults to 12 weeks", async () => {
    mockGetCohorts.mockResolvedValue([]);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getRetentionCohorts(req as Request, res as unknown as Response);

    expect(mockGetCohorts).toHaveBeenCalledWith(12);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("respects custom weeks param", async () => {
    mockGetCohorts.mockResolvedValue([]);
    const req = createMockRequest({ weeks: "6" });
    const res = createMockResponse();

    await AdminDashboardController.getRetentionCohorts(req as Request, res as unknown as Response);

    expect(mockGetCohorts).toHaveBeenCalledWith(6);
  });

  it("caps weeks at 12", async () => {
    mockGetCohorts.mockResolvedValue([]);
    const req = createMockRequest({ weeks: "50" });
    const res = createMockResponse();

    await AdminDashboardController.getRetentionCohorts(req as Request, res as unknown as Response);

    expect(mockGetCohorts).toHaveBeenCalledWith(12);
  });

  it("defaults invalid weeks to 12", async () => {
    mockGetCohorts.mockResolvedValue([]);
    const req = createMockRequest({ weeks: "abc" });
    const res = createMockResponse();

    await AdminDashboardController.getRetentionCohorts(req as Request, res as unknown as Response);

    expect(mockGetCohorts).toHaveBeenCalledWith(12);
  });
});

// ═══════════════════════════════════════════════════════════════
// getLtvMetrics
// ═══════════════════════════════════════════════════════════════
describe("AdminDashboardController.getLtvMetrics", () => {
  it("returns LTV data", async () => {
    const data = { avgLtv: 25 };
    mockGetLtvMetrics.mockResolvedValue(data);
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getLtvMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  });

  it("returns 500 on error", async () => {
    mockGetLtvMetrics.mockRejectedValue(new Error("fail"));
    const req = createMockRequest();
    const res = createMockResponse();

    await AdminDashboardController.getLtvMetrics(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
