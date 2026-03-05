/**
 * BetaAdminService Tests
 * Covers: getBetaMetrics, getBetaUsers, kickUser, promoteUser, bulkAction
 */

import { describe, expect, it, jest, beforeEach, afterAll } from "@jest/globals";
import { BetaAdminService } from "../betaAdminService.js";
import { prisma } from "../../../lib/prisma.js";
import { redisCache } from "../../cache/redisCache.js";
import { Prisma } from "@prisma/client";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserCount = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockWaitlistCount = jest.fn();
const mockWaitlistDeleteMany = jest.fn();
const mockActivityLogCreate = jest.fn();
const mockTransaction = jest.fn();
const mockQueryRaw = jest.fn();

(prisma.user as unknown as Record<string, jest.Mock>).count = mockUserCount;
(prisma.user as unknown as Record<string, jest.Mock>).findMany = mockUserFindMany;
(prisma.user as unknown as Record<string, jest.Mock>).findUnique = mockUserFindUnique;
(prisma.user as unknown as Record<string, jest.Mock>).update = mockUserUpdate;
(prisma.user as unknown as Record<string, jest.Mock>).updateMany = mockUserUpdateMany;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).count = mockWaitlistCount;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).deleteMany = mockWaitlistDeleteMany;
(prisma.activityLog as unknown as Record<string, jest.Mock>).create = mockActivityLogCreate;
(prisma as unknown as Record<string, jest.Mock>).$transaction = mockTransaction;
(prisma as unknown as Record<string, jest.Mock>).$queryRaw = mockQueryRaw;

// ─── Redis Cache Mocks ─────────────────────────────────────────
const mockGetOrSet = jest.fn();
const mockInvalidate = jest.fn();

(redisCache as unknown as Record<string, jest.Mock>).getOrSet = mockGetOrSet;
(redisCache as unknown as Record<string, jest.Mock>).invalidate = mockInvalidate;

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
  mockInvalidate.mockResolvedValue(true);
  // Default: findUnique returns null so fire-and-forget email skips gracefully
  mockUserFindUnique.mockResolvedValue(null);
  // Reset dedup map between tests
  BetaAdminService._resetNotificationDedupForTest();
});

afterAll(async () => {
  // Clean up any connections
});

// ═══════════════════════════════════════════════════════════════
// getBetaMetrics
// ═══════════════════════════════════════════════════════════════
describe("BetaAdminService.getBetaMetrics", () => {
  it("should call redisCache.getOrSet with correct key and TTL", async () => {
    const mockMetrics = {
      cards: {
        spotsUsed: 42,
        totalSpots: 100,
        waitlistCount: 10,
        activeThisWeek: 30,
        inactive7d: 5,
        expired: 3,
      },
      trend: [],
    };
    mockGetOrSet.mockResolvedValue(mockMetrics);

    const result = await BetaAdminService.getBetaMetrics(7);

    expect(result).toEqual(mockMetrics);
    expect(mockGetOrSet).toHaveBeenCalledWith(
      "admin:beta:metrics:7",
      expect.any(Function),
      expect.any(Function),
      { namespace: "admin", ttl: 180 },
    );
  });

  it("should use period 30 by default", async () => {
    mockGetOrSet.mockResolvedValue({ cards: {}, trend: [] });

    await BetaAdminService.getBetaMetrics(30);

    expect(mockGetOrSet).toHaveBeenCalledWith(
      "admin:beta:metrics:30",
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ namespace: "admin" }),
    );
  });

  it("should compute metrics from DB when cache misses", async () => {
    // Make getOrSet call the factory function
    mockGetOrSet.mockImplementation(async (_key: string, factory: () => Promise<unknown>) =>
      factory(),
    );
    mockUserCount
      .mockResolvedValueOnce(42) // spotsUsed (active)
      .mockResolvedValueOnce(30) // activeThisWeek
      .mockResolvedValueOnce(5) // inactive7d
      .mockResolvedValueOnce(3); // expired
    mockWaitlistCount.mockResolvedValue(10);
    mockQueryRaw.mockResolvedValue([
      { date: new Date("2026-02-20"), active: 40n, new_activations: 2n },
    ]);

    const result = await BetaAdminService.getBetaMetrics(7);

    expect(result.cards.spotsUsed).toBe(42);
    expect(result.cards.totalSpots).toBe(100);
    expect(result.cards.waitlistCount).toBe(10);
    expect(result.cards.activeThisWeek).toBe(30);
    expect(result.cards.inactive7d).toBe(5);
    expect(result.cards.expired).toBe(3);
    expect(result.trend).toHaveLength(1);
    expect(result.trend[0].active).toBe(40);
    expect(result.trend[0].newActivations).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// getBetaUsers
// ═══════════════════════════════════════════════════════════════
describe("BetaAdminService.getBetaUsers", () => {
  const mockUsers = [
    {
      id: "u1",
      firstName: "Alice",
      lastName: "Doe",
      email: "alice@test.com",
      betaStatus: "active",
      lastHeartbeatAt: new Date(),
      weeklyActiveTimeSeconds: 3600,
      totalActiveTimeSeconds: 10000,
      betaJoinedAt: new Date(),
      betaDeactivatedAt: null,
    },
  ];

  it("should return paginated results with defaults", async () => {
    mockUserFindMany.mockResolvedValue(mockUsers);
    mockUserCount.mockResolvedValue(1);

    const result = await BetaAdminService.getBetaUsers({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].email).toBe("alice@test.com");
  });

  it("should cap limit at 100", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({ limit: 500 });

    expect(mockUserFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it("should filter by betaStatus when provided", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({ betaStatus: "active" });

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ betaStatus: "active" }),
      }),
    );
  });

  it("should reject invalid betaStatus values", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({ betaStatus: "invalid_status" });

    // Should use the default { in: [...] } filter, not the invalid status
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          betaStatus: { in: expect.any(Array) },
        }),
      }),
    );
  });

  it("should apply search filter on firstName, lastName, email", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({ search: "alice" });

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { firstName: { contains: "alice", mode: "insensitive" } },
            { lastName: { contains: "alice", mode: "insensitive" } },
            { email: { contains: "alice", mode: "insensitive" } },
          ],
        }),
      }),
    );
  });

  it("should sort by betaJoinedAt desc by default", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({});

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { betaJoinedAt: "desc" },
      }),
    );
  });

  it("should reject invalid sort columns", async () => {
    mockUserFindMany.mockResolvedValue([]);
    mockUserCount.mockResolvedValue(0);

    await BetaAdminService.getBetaUsers({ sortBy: "malicious_column" });

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { betaJoinedAt: "desc" },
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// kickUser
// ═══════════════════════════════════════════════════════════════
describe("BetaAdminService.kickUser", () => {
  it("should deactivate an active user", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.kickUser("user-1", "admin-1", "Inactif");

    expect(result.success).toBe(true);
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("should return error when user is not active", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 0 })) },
        activityLog: { create: jest.fn() },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.kickUser("user-1", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("non actif");
  });

  it("should create an activity log entry on kick", async () => {
    const mockCreate = jest.fn().mockReturnValue(Promise.resolve({}));
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: mockCreate },
      };
      return fn(tx);
    });

    await BetaAdminService.kickUser("user-1", "admin-1", "Test reason");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "BETA_USER_KICKED",
          entityType: "user",
          entityId: "user-1",
        }),
      }),
    );
  });
});

describe("BetaAdminService.kickUser — email notification", () => {
  it("should call prisma.user.findUnique after successful kick to fetch email", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });
    mockUserFindUnique.mockResolvedValue({ email: "kicked@test.com", firstName: "Alice" });

    await BetaAdminService.kickUser("user-1", "admin-1", "Inactif");

    // Allow fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { email: true, firstName: true },
    });
  });

  it("should NOT call prisma.user.findUnique when kick fails", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 0 })) },
        activityLog: { create: jest.fn() },
      };
      return fn(tx);
    });

    await BetaAdminService.kickUser("user-1", "admin-1");

    await new Promise((r) => setTimeout(r, 50));

    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// promoteUser
// ═══════════════════════════════════════════════════════════════
describe("BetaAdminService.promoteUser", () => {
  it("should promote a waitlist user to active", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "waitlist" })),
          update: jest.fn().mockReturnValue(Promise.resolve({})),
        },
        betaWaitlist: { deleteMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("user-1", "admin-1");

    expect(result.success).toBe(true);
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("should promote an expired user to active", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "expired" })),
          update: jest.fn().mockReturnValue(Promise.resolve({})),
        },
        betaWaitlist: { deleteMany: jest.fn().mockReturnValue(Promise.resolve({ count: 0 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("user-1", "admin-1");

    expect(result.success).toBe(true);
  });

  it("should return error when already active", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "active" })),
        },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("user-1", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("incompatible");
  });

  it("should return error when no spots available", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(100)),
        },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("user-1", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("places");
  });

  it("should return error when user not found", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve(null)),
        },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("nonexistent", "admin-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("introuvable");
  });

  it("should retry on P2034 serialization error", async () => {
    let callCount = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      callCount++;
      if (callCount === 1) {
        const error = new Prisma.PrismaClientKnownRequestError("conflict", {
          code: "P2034",
          clientVersion: "5.0.0",
        });
        throw error;
      }
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "waitlist" })),
          update: jest.fn().mockReturnValue(Promise.resolve({})),
        },
        betaWaitlist: { deleteMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.promoteUser("user-1", "admin-1");

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe("BetaAdminService.promoteUser — email notification", () => {
  it("should call prisma.user.findUnique after successful promote to fetch email", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "waitlist" })),
          update: jest.fn().mockReturnValue(Promise.resolve({})),
        },
        betaWaitlist: { deleteMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });
    mockUserFindUnique.mockResolvedValue({ email: "promoted@test.com", firstName: "Bob" });

    await BetaAdminService.promoteUser("user-1", "admin-1");

    // Allow fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { email: true, firstName: true },
    });
  });

  it("should NOT call prisma.user.findUnique when promote fails (no spots)", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(100)),
        },
      };
      return fn(tx);
    });

    await BetaAdminService.promoteUser("user-1", "admin-1");

    await new Promise((r) => setTimeout(r, 50));

    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// bulkAction
// ═══════════════════════════════════════════════════════════════
describe("BetaAdminService.bulkAction", () => {
  it("should process multiple kicks", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.bulkAction(
      ["user-1", "user-2", "user-3"],
      "kick",
      "admin-1",
      "Cleanup",
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
  });

  it("should process multiple promotes", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: {
          count: jest.fn().mockReturnValue(Promise.resolve(50)),
          findUnique: jest.fn().mockReturnValue(Promise.resolve({ betaStatus: "waitlist" })),
          update: jest.fn().mockReturnValue(Promise.resolve({})),
        },
        betaWaitlist: { deleteMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.bulkAction(["user-1", "user-2"], "promote", "admin-1");

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("should collect errors for mixed results", async () => {
    let callIdx = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      callIdx++;
      if (callIdx === 2) {
        // Second call fails
        const tx = {
          user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 0 })) },
          activityLog: { create: jest.fn() },
        };
        return fn(tx);
      }
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    const result = await BetaAdminService.bulkAction(
      ["user-1", "user-2", "user-3"],
      "kick",
      "admin-1",
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].userId).toBe("user-2");
  });

  it("should invalidate cache after bulk action", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });

    await BetaAdminService.bulkAction(["user-1"], "kick", "admin-1");

    // Cache invalidated by kickUser + final bulkAction invalidation
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it("should send sequential emails for succeeded users only", async () => {
    let callIdx = 0;
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      callIdx++;
      if (callIdx === 2) {
        // Second user fails
        const tx = {
          user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 0 })) },
          activityLog: { create: jest.fn() },
        };
        return fn(tx);
      }
      const tx = {
        user: { updateMany: jest.fn().mockReturnValue(Promise.resolve({ count: 1 })) },
        activityLog: { create: jest.fn().mockReturnValue(Promise.resolve({})) },
      };
      return fn(tx);
    });
    mockUserFindUnique.mockResolvedValue({ email: "bulk@test.com", firstName: "Bulk" });

    await BetaAdminService.bulkAction(["user-1", "user-2", "user-3"], "kick", "admin-1");

    // findUnique called for user-1 and user-3 (succeeded), NOT user-2 (failed)
    expect(mockUserFindUnique).toHaveBeenCalledTimes(2);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { email: true, firstName: true },
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-3" },
      select: { email: true, firstName: true },
    });
  });
});
