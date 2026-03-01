/**
 * TrendsMetricsService Tests
 * Covers: getTrends with different periods, cache usage, granularity
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { TrendsMetricsService } from "../trendsMetricsService.js";
import { prisma } from "../../../lib/prisma.js";
import { redisCache } from "../../cache/redisCache.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockQueryRaw = jest.fn();

(prisma as unknown as Record<string, jest.Mock>).$queryRaw = mockQueryRaw;

// ─── Redis Cache Mocks ─────────────────────────────────────────
const mockGetOrSet = jest.fn();

(redisCache as unknown as Record<string, jest.Mock>).getOrSet = mockGetOrSet;

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

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════
// getTrends
// ═══════════════════════════════════════════════════════════════
describe("TrendsMetricsService.getTrends", () => {
  const mockTrendsResponse = {
    period: "7d" as const,
    granularity: "day" as const,
    metrics: {
      users: [{ date: "2026-02-27", value: 5 }],
      mrr: [{ date: "2026-02-27", value: 49.95 }],
      credits: [{ date: "2026-02-27", value: 120 }],
      quizzes: [{ date: "2026-02-27", value: 30 }],
    },
  };

  it("should call redisCache.getOrSet with correct key and TTL for 7d", async () => {
    mockGetOrSet.mockResolvedValue(mockTrendsResponse);

    const result = await TrendsMetricsService.getTrends("7d");

    expect(result).toEqual(mockTrendsResponse);
    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:trends:7d",
      expect.any(Function),
      expect.any(Function),
      { namespace: "admin", ttl: 900 },
    );
  });

  it("should use correct cache key for 30d period", async () => {
    mockGetOrSet.mockResolvedValue({ ...mockTrendsResponse, period: "30d" });

    await TrendsMetricsService.getTrends("30d");

    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:trends:30d",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ namespace: "admin", ttl: 900 }),
    );
  });

  it("should use correct cache key for 90d period", async () => {
    mockGetOrSet.mockResolvedValue({ ...mockTrendsResponse, period: "90d", granularity: "week" });

    await TrendsMetricsService.getTrends("90d");

    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:trends:90d",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ namespace: "admin", ttl: 900 }),
    );
  });

  it("should compute trends from DB when cache misses", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    // Each sub-query (users, mrr, credits, quizzes) calls $queryRaw
    mockQueryRaw
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-27"), count: 5n }]) // users
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-27"), count: 3n }]) // mrr (premium subs)
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-27"), total: 120.5 }]) // credits
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-27"), count: 10n }]); // quizzes

    const result = await TrendsMetricsService.getTrends("7d");

    expect(result.period).toBe("7d");
    expect(result.granularity).toBe("day");
    expect(result.metrics.users).toHaveLength(1);
    expect(result.metrics.users[0].value).toBe(5);
    expect(result.metrics.mrr[0].value).toBe(Math.round(3 * 9.99 * 100) / 100);
    expect(result.metrics.credits[0].value).toBe(Math.round(120.5 * 100) / 100);
    expect(result.metrics.quizzes[0].value).toBe(10);
  });

  it("should use 'week' granularity for 90d period", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    mockQueryRaw
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-23"), count: 15n }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-23"), count: 8n }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-23"), total: 300 }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-23"), count: 50n }]);

    const result = await TrendsMetricsService.getTrends("90d");

    expect(result.granularity).toBe("week");
    // Week format: YYYY-WXX
    expect(result.metrics.users[0].date).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("should handle empty data gracefully", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await TrendsMetricsService.getTrends("7d");

    expect(result.metrics.users).toHaveLength(0);
    expect(result.metrics.mrr).toHaveLength(0);
    expect(result.metrics.credits).toHaveLength(0);
    expect(result.metrics.quizzes).toHaveLength(0);
  });

  it("should handle null credit totals", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucket: new Date("2026-02-27"), total: null }])
      .mockResolvedValueOnce([]);

    const result = await TrendsMetricsService.getTrends("7d");

    expect(result.metrics.credits[0].value).toBe(0);
  });
});
