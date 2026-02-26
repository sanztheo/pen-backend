/**
 * BetaService Tests — Enterprise-grade coverage
 * Covers: status cache, heartbeat, waitlist, reactivation, retry serialization
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import { BetaService } from "../BetaService.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { Prisma } from "@prisma/client";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserCount = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserFindFirst = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockWaitlistCreate = jest.fn();
const mockWaitlistFindUnique = jest.fn();
const mockWaitlistCount = jest.fn();
const mockWaitlistDeleteMany = jest.fn();
const mockExecuteRaw = jest.fn();
const mockTransaction = jest.fn();

(prisma.user as any).count = mockUserCount;
(prisma.user as any).findUnique = mockUserFindUnique;
(prisma.user as any).findFirst = mockUserFindFirst;
(prisma.user as any).update = mockUserUpdate;
(prisma.user as any).updateMany = mockUserUpdateMany;
(prisma.betaWaitlist as any).create = mockWaitlistCreate;
(prisma.betaWaitlist as any).findUnique = mockWaitlistFindUnique;
(prisma.betaWaitlist as any).count = mockWaitlistCount;
(prisma.betaWaitlist as any).deleteMany = mockWaitlistDeleteMany;
(prisma as any).$executeRaw = mockExecuteRaw;
(prisma as any).$transaction = mockTransaction;

// ─── Redis Mocks ────────────────────────────────────────────────
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

(redis as any).get = mockRedisGet;
(redis as any).set = mockRedisSet;
(redis as any).del = mockRedisDel;

// ─── Suppress logger output in tests ────────────────────────────
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Test Helpers ───────────────────────────────────────────────
const TEST_DATE = new Date("2026-02-06T12:00:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisDel.mockResolvedValue(1);
  // Default: no active user found by email (public waitlist guard)
  mockUserFindFirst.mockResolvedValue(null);
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// getStatus
// ═══════════════════════════════════════════════════════════════
describe("BetaService.getStatus", () => {
  it("should return cached active count from Redis", async () => {
    mockRedisGet.mockResolvedValue("42");

    const result = await BetaService.getStatus();

    expect(mockRedisGet).toHaveBeenCalledWith("beta:active_count");
    expect(mockUserCount).not.toHaveBeenCalled();
    expect(result.spotsRemaining).toBe(58);
    expect(result.totalSpots).toBe(100);
    expect(result.isFull).toBe(false);
    expect(result.userStatus).toBeUndefined();
  });

  it("should query DB and cache when Redis has no data", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockUserCount.mockResolvedValue(95);
    mockRedisSet.mockResolvedValue("OK");

    const result = await BetaService.getStatus();

    expect(mockUserCount).toHaveBeenCalledWith({
      where: { betaStatus: "active" },
    });
    expect(mockRedisSet).toHaveBeenCalledWith("beta:active_count", 95, "EX", 30);
    expect(result.spotsRemaining).toBe(5);
  });

  it("should fallback to DB when Redis is down", async () => {
    mockRedisGet.mockRejectedValue(new Error("Redis connection refused"));
    mockUserCount.mockResolvedValue(100);

    const result = await BetaService.getStatus();

    expect(result.spotsRemaining).toBe(0);
    expect(result.isFull).toBe(true);
  });

  it("should include userStatus when userId is provided", async () => {
    mockRedisGet.mockResolvedValue("50");
    mockUserFindUnique.mockResolvedValue({ betaStatus: "active" });

    const result = await BetaService.getStatus("user-123");

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-123" },
      select: { betaStatus: true },
    });
    expect(result.userStatus).toBe("active");
  });

  it("should handle spotsRemaining never going negative", async () => {
    mockRedisGet.mockResolvedValue("150");

    const result = await BetaService.getStatus();

    expect(result.spotsRemaining).toBe(0);
    expect(result.isFull).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// recordHeartbeat
// ═══════════════════════════════════════════════════════════════
describe("BetaService.recordHeartbeat", () => {
  it("should return true when heartbeat is recorded", async () => {
    mockExecuteRaw.mockResolvedValue(1);

    const result = await BetaService.recordHeartbeat("user-123");

    expect(result).toBe(true);
    expect(mockExecuteRaw).toHaveBeenCalled();
  });

  it("should return false when no row is updated (anti-inflation guard)", async () => {
    mockExecuteRaw.mockResolvedValue(0);

    const result = await BetaService.recordHeartbeat("user-123");

    expect(result).toBe(false);
  });

  it("should return false for non-active user", async () => {
    mockExecuteRaw.mockResolvedValue(0);

    const result = await BetaService.recordHeartbeat("inactive-user");

    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// addToWaitlist
// ═══════════════════════════════════════════════════════════════
describe("BetaService.addToWaitlist", () => {
  const validInput = {
    email: "test@example.com",
    name: "Test User",
    metadata: { source: "landing" },
  };

  it("should create new waitlist entry for unauthenticated user", async () => {
    mockWaitlistCreate.mockResolvedValue({ id: "wl-1" });
    mockWaitlistFindUnique.mockResolvedValue({
      joinedAt: TEST_DATE,
    });
    mockWaitlistCount.mockResolvedValue(5);

    const result = await BetaService.addToWaitlist(validInput);

    expect(mockWaitlistCreate).toHaveBeenCalledWith({
      data: {
        email: "test@example.com",
        name: "Test User",
        userId: undefined,
        metadata: { source: "landing" },
      },
    });
    expect(result.alreadyExists).toBe(false);
    expect(result.rejected).toBe(false);
    expect(result.position).toBe(5);
  });

  it("should reject active users from joining waitlist", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "active" });

    const result = await BetaService.addToWaitlist(validInput, "active-user");

    expect(result.rejected).toBe(true);
    expect(result.position).toBe(0);
    expect(mockWaitlistCreate).not.toHaveBeenCalled();
  });

  it("should handle duplicate email gracefully (P2002)", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint violation", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mockWaitlistCreate.mockRejectedValue(prismaError);
    mockWaitlistFindUnique.mockResolvedValue({
      joinedAt: TEST_DATE,
    });
    mockWaitlistCount.mockResolvedValue(3);

    const result = await BetaService.addToWaitlist(validInput);

    expect(result.alreadyExists).toBe(true);
    expect(result.position).toBe(3);
  });

  it("should propagate non-P2002 Prisma errors", async () => {
    const otherError = new Error("Database connection lost");
    mockWaitlistCreate.mockRejectedValue(otherError);

    await expect(BetaService.addToWaitlist(validInput)).rejects.toThrow("Database connection lost");
  });

  // BM-003: Race condition guard — conditional updateMany
  it("should use conditional updateMany to prevent active->waitlist downgrade", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "waitlist" });
    mockWaitlistCreate.mockResolvedValue({ id: "wl-2" });
    mockUserUpdateMany.mockResolvedValue({ count: 1 });
    mockWaitlistFindUnique.mockResolvedValue({
      joinedAt: TEST_DATE,
    });
    mockWaitlistCount.mockResolvedValue(1);

    await BetaService.addToWaitlist(validInput, "user-456");

    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-456", betaStatus: { not: "active" } },
      data: { betaStatus: "waitlist" },
    });
    // Must NOT use prisma.user.update (non-conditional)
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// reactivateUser
// ═══════════════════════════════════════════════════════════════
describe("BetaService.reactivateUser", () => {
  it("should return USER_NOT_FOUND for unknown user", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const result = await BetaService.reactivateUser("unknown-id");

    expect(result.success).toBe(false);
    expect(result.code).toBe("USER_NOT_FOUND");
  });

  it("should return INVALID_STATUS for active user", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "active" });

    const result = await BetaService.reactivateUser("user-active");

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_STATUS");
  });

  it("should return INVALID_STATUS for waitlist user", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "waitlist" });

    const result = await BetaService.reactivateUser("user-waitlist");

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_STATUS");
  });

  it("should succeed for inactive user with available spots", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "inactive" });
    mockTransaction.mockResolvedValue(undefined);

    const result = await BetaService.reactivateUser("user-inactive");

    expect(result.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should succeed for pending_reactivation user", async () => {
    mockUserFindUnique.mockResolvedValue({
      betaStatus: "pending_reactivation",
    });
    mockTransaction.mockResolvedValue(undefined);

    const result = await BetaService.reactivateUser("user-pending");

    expect(result.success).toBe(true);
  });

  it("should return NO_SPOTS_AVAILABLE when beta is full", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "inactive" });
    mockTransaction.mockRejectedValue(new Error("NO_SPOTS_AVAILABLE"));

    const result = await BetaService.reactivateUser("user-inactive");

    expect(result.success).toBe(false);
    expect(result.code).toBe("NO_SPOTS_AVAILABLE");
  });

  it("should propagate unexpected transaction errors", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "inactive" });
    mockTransaction.mockRejectedValue(new Error("Connection timeout"));

    await expect(BetaService.reactivateUser("user-inactive")).rejects.toThrow("Connection timeout");
  });

  it("should invalidate Redis cache after successful reactivation", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "inactive" });
    mockTransaction.mockResolvedValue(undefined);

    await BetaService.reactivateUser("user-123");

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should not crash if Redis cache invalidation fails", async () => {
    mockUserFindUnique.mockResolvedValue({ betaStatus: "inactive" });
    mockTransaction.mockResolvedValue(undefined);
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    // Should not throw — redis.del().catch(() => {}) handles it
    const result = await BetaService.reactivateUser("user-123");
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// getWaitlistPosition (tested indirectly)
// ═══════════════════════════════════════════════════════════════
describe("BetaService — waitlist position calculation", () => {
  it("should return correct FIFO position", async () => {
    mockWaitlistCreate.mockResolvedValue({ id: "wl-1" });
    mockWaitlistFindUnique.mockResolvedValue({
      joinedAt: new Date("2026-02-01"),
    });
    mockWaitlistCount.mockResolvedValue(7);

    const result = await BetaService.addToWaitlist({
      email: "pos@test.com",
      name: "Position Test",
    });

    expect(result.position).toBe(7);
    expect(mockWaitlistCount).toHaveBeenCalledWith({
      where: {
        joinedAt: { lte: new Date("2026-02-01") },
      },
    });
  });

  it("should return 0 when entry not found", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint violation", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mockWaitlistCreate.mockRejectedValue(prismaError);
    mockWaitlistFindUnique.mockResolvedValue(null);

    const result = await BetaService.addToWaitlist({
      email: "ghost@test.com",
      name: "Ghost",
    });

    expect(result.position).toBe(0);
  });
});
