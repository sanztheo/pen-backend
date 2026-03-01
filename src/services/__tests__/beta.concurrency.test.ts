/**
 * Beta Concurrency Tests
 * Covers: race conditions on reactivation, heartbeat, promotion, bulk actions
 *
 * Strategy: Configure Prisma mocks to simulate concurrent state changes
 * using call-order-dependent behavior via mockImplementationOnce.
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import { BetaService } from "../BetaService.js";
import { BetaAdminService } from "../admin/betaAdminService.js";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { Prisma } from "@prisma/client";
import { TOTAL_BETA_SPOTS } from "../BetaService.types.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserCount = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserFindFirst = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockWaitlistDeleteMany = jest.fn();
const mockActivityLogCreate = jest.fn();
const mockTransaction = jest.fn();
const mockExecuteRaw = jest.fn();

(prisma.user as Record<string, unknown>).count = mockUserCount;
(prisma.user as Record<string, unknown>).findUnique = mockUserFindUnique;
(prisma.user as Record<string, unknown>).findFirst = mockUserFindFirst;
(prisma.user as Record<string, unknown>).update = mockUserUpdate;
(prisma.user as Record<string, unknown>).updateMany = mockUserUpdateMany;
(prisma.betaWaitlist as Record<string, unknown>).deleteMany = mockWaitlistDeleteMany;
(prisma.activityLog as Record<string, unknown>).create = mockActivityLogCreate;
(prisma as Record<string, unknown>).$transaction = mockTransaction;
(prisma as Record<string, unknown>).$executeRaw = mockExecuteRaw;

// ─── Redis Mocks ────────────────────────────────────────────────
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

(redis as Record<string, unknown>).get = mockRedisGet;
(redis as Record<string, unknown>).set = mockRedisSet;
(redis as Record<string, unknown>).del = mockRedisDel;

// ─── Suppress logger ────────────────────────────────────────────
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Cache service mock ─────────────────────────────────────────
jest.unstable_mockModule("../../services/cache/redisCache.js", () => ({
  redisCache: {
    getOrSet: jest
      .fn()
      .mockImplementation((_key: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: jest.fn().mockResolvedValue(undefined),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisDel.mockResolvedValue(1);
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// Concurrent Reactivation — 2 users, 1 spot
// ═══════════════════════════════════════════════════════════════
describe("Concurrent reactivation — 2 users, 1 spot", () => {
  it("should allow only 1 user to reactivate when 1 spot remains", async () => {
    // User A and User B both in inactive status
    mockUserFindUnique.mockImplementation((args: { where: { id: string } }) => {
      return Promise.resolve({
        id: args.where.id,
        betaStatus: "inactive",
      });
    });

    let transactionCallCount = 0;

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      transactionCallCount++;
      const call = transactionCallCount;

      const tx = {
        user: {
          count: jest.fn().mockImplementation(() => {
            // First transaction sees spots-1 available, second sees spots full
            return Promise.resolve(call === 1 ? TOTAL_BETA_SPOTS - 1 : TOTAL_BETA_SPOTS);
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ betaStatus: "inactive" }),
          update: jest.fn().mockResolvedValue({}),
        },
        betaWaitlist: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      await fn(tx);
    });

    // Launch both reactivations concurrently
    const [resultA, resultB] = await Promise.all([
      BetaService.reactivateUser("user_A"),
      BetaService.reactivateUser("user_B"),
    ]);

    // Exactly one should succeed
    const successes = [resultA, resultB].filter((r) => r.success);
    const failures = [resultA, resultB].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].code).toBe("NO_SPOTS_AVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// Concurrent Heartbeat — same user, 2 simultaneous requests
// ═══════════════════════════════════════════════════════════════
describe("Concurrent heartbeat — same user", () => {
  it("should handle concurrent heartbeats without corruption", async () => {
    // The raw UPDATE with WHERE guard prevents double-counting
    mockExecuteRaw
      .mockResolvedValueOnce(1) // First heartbeat succeeds (>25s since last)
      .mockResolvedValueOnce(0); // Second heartbeat rejected (< 25s since first)

    const [resultA, resultB] = await Promise.all([
      BetaService.recordHeartbeat("user_concurrent"),
      BetaService.recordHeartbeat("user_concurrent"),
    ]);

    // One should succeed (returned rows > 0), one should be no-op (0 rows)
    const accepted = [resultA, resultB].filter(Boolean);
    const rejected = [resultA, resultB].filter((r) => !r);

    expect(accepted.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Admin promote — serialization retry (P2034)
// ═══════════════════════════════════════════════════════════════
describe("Admin promote — serialization conflict", () => {
  it("should retry on P2034 and succeed on second attempt", async () => {
    let callCount = 0;

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      callCount++;
      if (callCount === 1) {
        const p2034 = new Prisma.PrismaClientKnownRequestError(
          "Transaction failed due to a write conflict or a deadlock",
          { code: "P2034", clientVersion: "5.0.0" },
        );
        throw p2034;
      }

      const tx = {
        user: {
          count: jest.fn().mockResolvedValue(TOTAL_BETA_SPOTS - 1),
          findUnique: jest.fn().mockResolvedValue({ betaStatus: "waitlist" }),
          update: jest.fn().mockResolvedValue({}),
        },
        betaWaitlist: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        activityLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      await fn(tx);
    });

    const result = await BetaAdminService.promoteUser("target_user", "admin_1");

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  it("should fail after max retries on persistent P2034", async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Transaction failed", {
        code: "P2034",
        clientVersion: "5.0.0",
      });
    });

    await expect(BetaAdminService.promoteUser("target_user", "admin_1")).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// Concurrent promote + reactivate — no double spot usage
// ═══════════════════════════════════════════════════════════════
describe("Concurrent promote + reactivate", () => {
  it("should not exceed total spots with concurrent promote and reactivate", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user_reactivate",
      betaStatus: "inactive",
    });

    let transactionCallCount = 0;

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      transactionCallCount++;
      const call = transactionCallCount;

      const tx = {
        user: {
          count: jest.fn().mockImplementation(() => {
            // Both see 1 spot available, but second should fail
            // in a real scenario the Serializable isolation would prevent this
            return Promise.resolve(call === 1 ? TOTAL_BETA_SPOTS - 1 : TOTAL_BETA_SPOTS);
          }),
          findUnique: jest.fn().mockResolvedValue({ betaStatus: "waitlist" }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ betaStatus: "inactive" }),
          update: jest.fn().mockResolvedValue({}),
        },
        betaWaitlist: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        activityLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      await fn(tx);
    });

    const [promoteResult, reactivateResult] = await Promise.all([
      BetaAdminService.promoteUser("waitlist_user", "admin_1"),
      BetaService.reactivateUser("user_reactivate"),
    ]);

    const successes = [promoteResult, reactivateResult].filter((r) => r.success);
    const failures = [promoteResult, reactivateResult].filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Bulk kick during reactivation — consistency
// ═══════════════════════════════════════════════════════════════
describe("Bulk kick during reactivation", () => {
  it("should handle bulk kick and reactivation executing concurrently", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user_reactivate",
      betaStatus: "inactive",
    });

    let txCallCount = 0;

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      txCallCount++;

      // Kick transaction: succeeds
      if (txCallCount <= 2) {
        const tx = {
          user: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            count: jest.fn().mockResolvedValue(TOTAL_BETA_SPOTS),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ betaStatus: "inactive" }),
            update: jest.fn().mockResolvedValue({}),
          },
          activityLog: {
            create: jest.fn().mockResolvedValue({}),
          },
          betaWaitlist: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        await fn(tx);
        return { count: 1 };
      }

      // Reactivate transaction: sees full spots after kick frees some
      const tx = {
        user: {
          count: jest.fn().mockResolvedValue(TOTAL_BETA_SPOTS),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ betaStatus: "inactive" }),
          update: jest.fn().mockResolvedValue({}),
        },
        betaWaitlist: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      await fn(tx);
    });

    const [kickResult, reactivateResult] = await Promise.all([
      BetaAdminService.kickUser("active_user", "admin_1"),
      BetaService.reactivateUser("user_reactivate"),
    ]);

    // Both operations should complete without throwing
    expect(kickResult).toBeDefined();
    expect(reactivateResult).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Reactivation status change race
// ═══════════════════════════════════════════════════════════════
describe("Reactivation — status change race", () => {
  it("should detect status change inside transaction (expired between check and transaction)", async () => {
    // Pre-check: user is inactive
    mockUserFindUnique.mockResolvedValue({
      id: "user_race",
      betaStatus: "inactive",
    });

    // But inside transaction, status changed to expired (cron ran in between)
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        user: {
          count: jest.fn().mockResolvedValue(TOTAL_BETA_SPOTS - 5),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ betaStatus: "expired" }),
          update: jest.fn().mockResolvedValue({}),
        },
        betaWaitlist: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      await fn(tx);
    });

    const result = await BetaService.reactivateUser("user_race");

    expect(result.success).toBe(false);
    expect(result.code).toBe("STATUS_CHANGED");
  });
});
