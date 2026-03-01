/**
 * RetentionCohortService Tests
 * Covers: getCohorts, week bounds clamping, empty data, retention percentages
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { RetentionCohortService } from "../retentionCohortService.js";
import { prisma } from "../../../lib/prisma.js";
import { redisCache } from "../../cache/redisCache.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockRetentionCohortFindMany = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockRetentionCohortUpsert = jest.fn();

(prisma.retentionCohort as unknown as Record<string, jest.Mock>).findMany =
  mockRetentionCohortFindMany;
(prisma.retentionCohort as unknown as Record<string, jest.Mock>).upsert = mockRetentionCohortUpsert;
(prisma.user as unknown as Record<string, jest.Mock>).findMany = mockUserFindMany;
(prisma.user as unknown as Record<string, jest.Mock>).count = mockUserCount;

// ─── Redis Cache Mocks ─────────────────────────────────────────
const mockGetOrSet = jest.fn();
const mockInvalidatePattern = jest.fn();

(redisCache as unknown as Record<string, jest.Mock>).getOrSet = mockGetOrSet;
(redisCache as unknown as Record<string, jest.Mock>).invalidatePattern = mockInvalidatePattern;

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
  mockInvalidatePattern.mockResolvedValue(0);
});

// ═══════════════════════════════════════════════════════════════
// getCohorts
// ═══════════════════════════════════════════════════════════════
describe("RetentionCohortService.getCohorts", () => {
  it("should call redisCache.getOrSet with clamped weeks", async () => {
    const mockResponse = { cohorts: [], maxWeeks: 4 };
    mockGetOrSet.mockResolvedValue(mockResponse);

    const result = await RetentionCohortService.getCohorts(6);

    expect(result).toEqual(mockResponse);
    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:cohorts:6",
      expect.any(Function),
      expect.any(Function),
      { namespace: "admin", ttl: 3600 },
    );
  });

  it("should clamp weeks to max 12", async () => {
    mockGetOrSet.mockResolvedValue({ cohorts: [], maxWeeks: 4 });

    await RetentionCohortService.getCohorts(20);

    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:cohorts:12",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ namespace: "admin" }),
    );
  });

  it("should clamp weeks to min 1", async () => {
    mockGetOrSet.mockResolvedValue({ cohorts: [], maxWeeks: 4 });

    await RetentionCohortService.getCohorts(0);

    expect(mockGetOrSet).toHaveBeenCalledWith(
      "metrics:cohorts:1",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ namespace: "admin" }),
    );
  });

  it("should return empty cohorts when no data in DB", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    // No distinct cohort weeks
    mockRetentionCohortFindMany.mockResolvedValueOnce([]);

    const result = await RetentionCohortService.getCohorts(6);

    expect(result.cohorts).toHaveLength(0);
    expect(result.maxWeeks).toBe(4);
  });

  it("should read cohorts from DB and format correctly", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    // First call: distinct cohort weeks
    mockRetentionCohortFindMany.mockResolvedValueOnce([
      { cohortWeek: "2026-W08" },
      { cohortWeek: "2026-W07" },
    ]);

    // Second call: retention data for those weeks
    mockRetentionCohortFindMany.mockResolvedValueOnce([
      { cohortWeek: "2026-W08", weekNumber: 0, totalUsers: 50, retentionRate: 100 },
      { cohortWeek: "2026-W08", weekNumber: 1, totalUsers: 50, retentionRate: 72.5 },
      { cohortWeek: "2026-W07", weekNumber: 0, totalUsers: 30, retentionRate: 100 },
      { cohortWeek: "2026-W07", weekNumber: 1, totalUsers: 30, retentionRate: 60 },
      { cohortWeek: "2026-W07", weekNumber: 2, totalUsers: 30, retentionRate: 45.33 },
    ]);

    const result = await RetentionCohortService.getCohorts(4);

    expect(result.cohorts).toHaveLength(2);
    // Sorted descending
    expect(result.cohorts[0].week).toBe("2026-W08");
    expect(result.cohorts[0].totalUsers).toBe(50);
    expect(result.cohorts[0].retention).toEqual([100, 72.5]);

    expect(result.cohorts[1].week).toBe("2026-W07");
    expect(result.cohorts[1].totalUsers).toBe(30);
    expect(result.cohorts[1].retention).toEqual([100, 60, 45.33]);
    expect(result.maxWeeks).toBe(4);
  });

  it("should round retention rates to 2 decimal places", async () => {
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );

    mockRetentionCohortFindMany.mockResolvedValueOnce([{ cohortWeek: "2026-W09" }]);
    mockRetentionCohortFindMany.mockResolvedValueOnce([
      { cohortWeek: "2026-W09", weekNumber: 0, totalUsers: 100, retentionRate: 100 },
      { cohortWeek: "2026-W09", weekNumber: 1, totalUsers: 100, retentionRate: 66.6667 },
    ]);

    const result = await RetentionCohortService.getCohorts(4);

    // Math.round(66.6667 * 100) / 100 = 66.67
    expect(result.cohorts[0].retention[1]).toBe(66.67);
  });
});
