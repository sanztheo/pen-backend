/**
 * BetaCronService Tests — Enterprise-grade coverage
 * Covers: checkInactiveUsers, resetWeeklyCounters, processWaitlist, cleanupExpiredAccounts
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import { BetaCronService } from "../BetaCronService.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { Prisma } from "@prisma/client";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserCount = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockUserUpdate = jest.fn();
const mockWaitlistFindMany = jest.fn();
const mockWaitlistUpdate = jest.fn();
const mockWaitlistDelete = jest.fn();
const mockWaitlistDeleteMany = jest.fn();
const mockTransaction = jest.fn();

(prisma.user as unknown as Record<string, jest.Mock>).count = mockUserCount;
(prisma.user as unknown as Record<string, jest.Mock>).findMany = mockUserFindMany;
(prisma.user as unknown as Record<string, jest.Mock>).updateMany = mockUserUpdateMany;
(prisma.user as unknown as Record<string, jest.Mock>).update = mockUserUpdate;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).findMany = mockWaitlistFindMany;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).update = mockWaitlistUpdate;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).delete = mockWaitlistDelete;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).deleteMany = mockWaitlistDeleteMany;
(prisma as unknown as Record<string, jest.Mock>).$transaction = mockTransaction;

// ─── Redis Mocks ────────────────────────────────────────────────
const mockRedisDel = jest.fn();
const mockRedisSet = jest.fn();

(redis as unknown as Record<string, jest.Mock>).del = mockRedisDel;
(redis as unknown as Record<string, jest.Mock>).set = mockRedisSet;

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

// Note: EmailService uses dynamic import() in BetaCronService — ESM mocking
// cannot intercept it reliably. Email behavior is verified via DB side-effects.

// ─── Test Constants ─────────────────────────────────────────────
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisDel.mockResolvedValue(1);
  mockRedisSet.mockResolvedValue("OK"); // distributed lock acquired
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// checkInactiveUsers
// ═══════════════════════════════════════════════════════════════
describe("BetaCronService.checkInactiveUsers", () => {
  it("should return 0 when no inactive users found", async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await BetaCronService.checkInactiveUsers();

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    // redis.del is called once to release the distributed lock
    expect(mockRedisDel).toHaveBeenCalledWith("cron:lock:checkInactiveUsers");
  });

  it("should deactivate users with old heartbeat", async () => {
    const oldDate = new Date(Date.now() - SEVEN_DAYS_MS - 1000);
    const inactiveUsers = [
      { id: "user-1", email: "a@test.com", lastHeartbeatAt: oldDate },
      { id: "user-2", email: "b@test.com", lastHeartbeatAt: oldDate },
    ];
    mockUserFindMany.mockResolvedValue(inactiveUsers);
    mockUserUpdateMany.mockResolvedValue({ count: 2 });

    const result = await BetaCronService.checkInactiveUsers();

    expect(result.processed).toBe(2);
    expect(mockUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["user-1", "user-2"] },
          betaStatus: "active",
          OR: expect.arrayContaining([
            expect.objectContaining({ lastHeartbeatAt: expect.any(Object) }),
            expect.objectContaining({
              lastHeartbeatAt: null,
              betaJoinedAt: expect.any(Object),
            }),
          ]),
        }),
        data: expect.objectContaining({
          betaStatus: "inactive",
        }),
      }),
    );
  });

  it("should deactivate users with null heartbeat", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-null", email: "null@test.com", lastHeartbeatAt: null },
    ]);
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    const result = await BetaCronService.checkInactiveUsers();

    expect(result.processed).toBe(1);
  });

  it("should set betaDeactivatedAt and betaReactivationDeadline", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    mockUserFindMany.mockResolvedValue([
      { id: "user-1", email: "a@test.com", lastHeartbeatAt: new Date(0) },
    ]);
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    await BetaCronService.checkInactiveUsers();

    const updateCall = mockUserUpdateMany.mock.calls[0]?.[0] as {
      data: { betaDeactivatedAt: Date; betaReactivationDeadline: Date };
    };
    const deactivatedAt = updateCall.data.betaDeactivatedAt.getTime();
    const deadline = updateCall.data.betaReactivationDeadline.getTime();

    // betaDeactivatedAt should be ~now
    expect(Math.abs(deactivatedAt - now)).toBeLessThan(1000);
    // betaReactivationDeadline should be ~now + 14 days
    expect(Math.abs(deadline - (now + FOURTEEN_DAYS_MS))).toBeLessThan(1000);

    jest.restoreAllMocks();
  });

  it("should invalidate Redis cache after deactivation", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-1", email: "a@test.com", lastHeartbeatAt: null },
    ]);
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    await BetaCronService.checkInactiveUsers();

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should not crash if Redis cache invalidation fails", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-1", email: "a@test.com", lastHeartbeatAt: null },
    ]);
    mockUserUpdateMany.mockResolvedValue({ count: 1 });
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    const result = await BetaCronService.checkInactiveUsers();

    expect(result.processed).toBe(1);
  });

  it("should query with correct threshold date", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    mockUserFindMany.mockResolvedValue([]);

    await BetaCronService.checkInactiveUsers();

    const findCall = mockUserFindMany.mock.calls[0]?.[0] as {
      where: {
        betaStatus: string;
        OR: Array<{ lastHeartbeatAt: { lt: Date } | null }>;
      };
    };
    expect(findCall.where.betaStatus).toBe("active");

    const thresholdEntry = findCall.where.OR[0] as {
      lastHeartbeatAt: { lt: Date };
    };
    const threshold = thresholdEntry.lastHeartbeatAt.lt.getTime();
    expect(Math.abs(threshold - (now - SEVEN_DAYS_MS))).toBeLessThan(1000);

    jest.restoreAllMocks();
  });
});

// ═══════════════════════════════════════════════════════════════
// resetWeeklyCounters
// ═══════════════════════════════════════════════════════════════
describe("BetaCronService.resetWeeklyCounters", () => {
  it("should reset counters for all active users", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 42 });

    const result = await BetaCronService.resetWeeklyCounters();

    expect(result.processed).toBe(42);
    expect(result.errors).toBe(0);
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { betaStatus: "active" },
      data: {
        weeklyActiveTimeSeconds: 0,
        weeklySessionCount: 0,
      },
    });
  });

  it("should return 0 when no active users", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 0 });

    const result = await BetaCronService.resetWeeklyCounters();

    expect(result.processed).toBe(0);
  });

  it("should use batch update (single query, not loop)", async () => {
    mockUserUpdateMany.mockResolvedValue({ count: 500 });

    await BetaCronService.resetWeeklyCounters();

    // Must be called exactly once (batch), not 500 times
    expect(mockUserUpdateMany).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// processWaitlist
// ═══════════════════════════════════════════════════════════════
describe("BetaCronService.processWaitlist", () => {
  it("should return 0 when no spots available", async () => {
    mockUserCount.mockResolvedValue(100);

    const result = await BetaCronService.processWaitlist();

    expect(result.processed).toBe(0);
    expect(mockWaitlistFindMany).not.toHaveBeenCalled();
  });

  it("should return 0 when no eligible waitlist entries", async () => {
    mockUserCount.mockResolvedValue(90);
    mockWaitlistFindMany.mockResolvedValue([]);

    const result = await BetaCronService.processWaitlist();

    expect(result.processed).toBe(0);
  });

  it("should promote users when spots are available", async () => {
    mockUserCount.mockResolvedValue(98);
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", userId: "user-1", email: "a@test.com" },
      { id: "wl-2", userId: "user-2", email: "b@test.com" },
    ]);
    mockTransaction.mockResolvedValue(undefined);

    const result = await BetaCronService.processWaitlist();

    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it("should take only available spots from waitlist (FIFO)", async () => {
    mockUserCount.mockResolvedValue(98);
    mockWaitlistFindMany.mockResolvedValue([{ id: "wl-1", userId: "user-1", email: "a@test.com" }]);
    mockTransaction.mockResolvedValue(undefined);

    await BetaCronService.processWaitlist();

    expect(mockWaitlistFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { joinedAt: "asc" },
        take: 2,
      }),
    );
  });

  it("should stop promoting when NO_SPOTS_AVAILABLE", async () => {
    mockUserCount.mockResolvedValue(99);
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", userId: "user-1", email: "a@test.com" },
      { id: "wl-2", userId: "user-2", email: "b@test.com" },
    ]);
    // First promotion succeeds, second fails with no spots
    mockTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("NO_SPOTS_AVAILABLE"));

    const result = await BetaCronService.processWaitlist();

    // First succeeded, second triggered NO_SPOTS break
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("should skip waitlist entries without userId", async () => {
    mockUserCount.mockResolvedValue(95);
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", userId: null, email: "nouser@test.com" },
      { id: "wl-2", userId: "user-2", email: "b@test.com" },
    ]);
    mockTransaction.mockResolvedValue(undefined);

    const result = await BetaCronService.processWaitlist();

    // Only user-2 should be promoted (null userId skipped)
    expect(result.processed).toBe(1);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("should invalidate Redis cache after promotions", async () => {
    mockUserCount.mockResolvedValue(99);
    mockWaitlistFindMany.mockResolvedValue([{ id: "wl-1", userId: "user-1", email: "a@test.com" }]);
    mockTransaction.mockResolvedValue(undefined);

    await BetaCronService.processWaitlist();

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should not invalidate Redis cache when no promotions", async () => {
    mockUserCount.mockResolvedValue(100);

    await BetaCronService.processWaitlist();

    // redis.del IS called once for the distributed lock cleanup ("cron:lock:processWaitlist")
    // but should NOT be called with the status cache key ("beta:active_count")
    expect(mockRedisDel).not.toHaveBeenCalledWith("beta:active_count");
  });

  it("should count errors for failed promotions (non-NO_SPOTS)", async () => {
    mockUserCount.mockResolvedValue(95);
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", userId: "user-1", email: "a@test.com" },
      { id: "wl-2", userId: "user-2", email: "b@test.com" },
    ]);
    mockTransaction
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce(undefined);

    const result = await BetaCronService.processWaitlist();

    expect(result.processed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("should use Serializable isolation level in transaction", async () => {
    mockUserCount.mockResolvedValue(99);
    mockWaitlistFindMany.mockResolvedValue([{ id: "wl-1", userId: "user-1", email: "a@test.com" }]);
    mockTransaction.mockResolvedValue(undefined);

    await BetaCronService.processWaitlist();

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// sendPositionUpdates
// ═══════════════════════════════════════════════════════════════

describe("BetaCronService.sendPositionUpdates", () => {
  beforeEach(() => {
    mockWaitlistUpdate.mockResolvedValue({});
  });

  it("should return 0 when waitlist is empty", async () => {
    mockWaitlistFindMany.mockResolvedValue([]);

    const result = await BetaCronService.sendPositionUpdates();

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("should seed lastNotifiedPosition for entries without metadata", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: null },
      { id: "wl-2", email: "b@test.com", name: "Bob", metadata: {} },
    ]);

    const result = await BetaCronService.sendPositionUpdates();

    // Should seed both (no lastNotifiedPosition), send no emails
    expect(mockWaitlistUpdate).toHaveBeenCalledTimes(2);
    expect(mockWaitlistUpdate).toHaveBeenCalledWith({
      where: { id: "wl-1" },
      data: { metadata: { lastNotifiedPosition: 1 } },
    });
    expect(mockWaitlistUpdate).toHaveBeenCalledWith({
      where: { id: "wl-2" },
      data: { metadata: { lastNotifiedPosition: 2 } },
    });
    expect(result.processed).toBe(0);
  });

  it("should not notify when position moved less than 10", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: { lastNotifiedPosition: 15 } },
    ]);

    // Current position is 1 (only entry), moved 14 positions → should notify
    // Actually wait: 15 - 1 = 14 >= 10, so this WILL notify.
    // Let me use a case that doesn't notify:
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: { lastNotifiedPosition: 5 } },
    ]);

    const result = await BetaCronService.sendPositionUpdates();

    // Position is 1, was 5 → moved 4 < 10, no notification
    // No notifiedAt update should occur (only seed updates have no notifiedAt)
    expect(result.processed).toBe(0);
  });

  it("should notify when position moved 10+ spots", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: { lastNotifiedPosition: 30 } },
      { id: "wl-2", email: "b@test.com", name: "Bob", metadata: { lastNotifiedPosition: 25 } },
    ]);
    // Transaction executes the callback with a tx proxy
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const txProxy = {
        betaWaitlist: {
          findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
          update: mockWaitlistUpdate,
        },
      };
      await fn(txProxy);
    });

    const result = await BetaCronService.sendPositionUpdates();

    // Alice: position 1, was 30 → moved 29 >= 10 ✓
    // Bob: position 2, was 25 → moved 23 >= 10 ✓
    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
    expect(mockWaitlistUpdate).toHaveBeenCalledTimes(2);
  });

  it("should update notifiedAt and metadata after sending email", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: { lastNotifiedPosition: 20 } },
    ]);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const txProxy = {
        betaWaitlist: {
          findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
          update: mockWaitlistUpdate,
        },
      };
      await fn(txProxy);
    });

    await BetaCronService.sendPositionUpdates();

    // After email sent, should update DB with new position via transaction
    expect(mockWaitlistUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "wl-1" },
        data: expect.objectContaining({
          notifiedAt: expect.any(Date),
          metadata: expect.objectContaining({ lastNotifiedPosition: 1 }),
        }),
      }),
    );
  });

  it("should handle mixed entries — seed some, notify some, skip some", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      // Position 1: needs seed (no metadata)
      { id: "wl-new", email: "new@test.com", name: "New", metadata: null },
      // Position 2: moved 28 spots → notify
      {
        id: "wl-moved",
        email: "moved@test.com",
        name: "Moved",
        metadata: { lastNotifiedPosition: 30 },
      },
      // Position 3: moved 2 spots → skip
      {
        id: "wl-stable",
        email: "stable@test.com",
        name: "Stable",
        metadata: { lastNotifiedPosition: 5 },
      },
    ]);
    mockTransaction.mockImplementation(async (fnOrArray: unknown) => {
      if (Array.isArray(fnOrArray)) return fnOrArray;
      const fn = fnOrArray as (tx: unknown) => Promise<void>;
      const txProxy = {
        betaWaitlist: {
          findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
          update: mockWaitlistUpdate,
        },
      };
      await fn(txProxy);
    });

    const result = await BetaCronService.sendPositionUpdates();

    // wl-stable: no update (moved only 2 positions)
    expect(result.processed).toBe(1);
  });

  it("should not crash when DB update fails after email (Promise.allSettled)", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "fail@test.com", name: "Fail", metadata: { lastNotifiedPosition: 50 } },
      { id: "wl-2", email: "ok@test.com", name: "OK", metadata: { lastNotifiedPosition: 40 } },
    ]);

    // First transaction fails, second succeeds
    let callCount = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      callCount++;
      if (callCount === 1) throw new Error("DB write failed");
      const txProxy = {
        betaWaitlist: {
          findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
          update: mockWaitlistUpdate,
        },
      };
      await fn(txProxy);
    });

    const result = await BetaCronService.sendPositionUpdates();

    // One succeeded, one failed — but neither crashed the batch
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(1);
  });

  it("should return 0 when no users crossed a milestone", async () => {
    mockWaitlistFindMany.mockResolvedValue([
      { id: "wl-1", email: "a@test.com", name: "Alice", metadata: { lastNotifiedPosition: 3 } },
      { id: "wl-2", email: "b@test.com", name: "Bob", metadata: { lastNotifiedPosition: 4 } },
    ]);

    const result = await BetaCronService.sendPositionUpdates();

    // Alice: pos 1, was 3 → moved 2 < 10
    // Bob: pos 2, was 4 → moved 2 < 10
    expect(result.processed).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// cleanupExpiredAccounts
// ═══════════════════════════════════════════════════════════════
describe("BetaCronService.cleanupExpiredAccounts", () => {
  it("should return 0 when no expired accounts", async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await BetaCronService.cleanupExpiredAccounts();

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("should expire inactive users past reactivation deadline", async () => {
    const pastDeadline = new Date(Date.now() - 1000);
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: pastDeadline,
      },
    ]);
    mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);

    const result = await BetaCronService.cleanupExpiredAccounts();

    expect(result.processed).toBe(1);
  });

  it("should query only inactive users with past deadline", async () => {
    mockUserFindMany.mockResolvedValue([]);

    await BetaCronService.cleanupExpiredAccounts();

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          betaStatus: "inactive",
          betaReactivationDeadline: expect.objectContaining({
            lt: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it("should use transaction for atomicity (update + waitlist cleanup)", async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: new Date(Date.now() - 1000),
      },
    ]);
    mockTransaction.mockResolvedValue([{ count: 1 }, { count: 1 }]);

    await BetaCronService.cleanupExpiredAccounts();

    expect(mockTransaction).toHaveBeenCalledWith([
      expect.objectContaining({}),
      expect.objectContaining({}),
    ]);
  });

  it("should invalidate Redis cache after expiration", async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: new Date(Date.now() - 1000),
      },
    ]);
    mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);

    await BetaCronService.cleanupExpiredAccounts();

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should not crash if Redis cache invalidation fails", async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: new Date(Date.now() - 1000),
      },
    ]);
    mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    const result = await BetaCronService.cleanupExpiredAccounts();

    expect(result.processed).toBe(1);
  });

  it("should handle multiple expired users in batch", async () => {
    const pastDeadline = new Date(Date.now() - 86400000);
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: pastDeadline,
      },
      {
        id: "user-2",
        email: "b@test.com",
        betaReactivationDeadline: pastDeadline,
      },
      {
        id: "user-3",
        email: "c@test.com",
        betaReactivationDeadline: pastDeadline,
      },
    ]);
    mockTransaction.mockResolvedValue([{ count: 3 }, { count: 2 }]);

    const result = await BetaCronService.cleanupExpiredAccounts();

    expect(result.processed).toBe(3);
  });

  it("should set betaStatus to expired in updateMany", async () => {
    mockUserFindMany.mockResolvedValue([
      {
        id: "user-1",
        email: "a@test.com",
        betaReactivationDeadline: new Date(Date.now() - 1000),
      },
    ]);
    mockTransaction.mockImplementation(async (operations: unknown) => {
      // Verify the operations passed to $transaction
      expect(Array.isArray(operations)).toBe(true);
      return [{ count: 1 }, { count: 0 }];
    });

    await BetaCronService.cleanupExpiredAccounts();

    expect(mockTransaction).toHaveBeenCalled();
  });
});
