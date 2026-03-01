/**
 * UserBulkService Tests
 * Covers: bulkAction activate/deactivate, self-inclusion, admin protection, error collection
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { UserBulkService } from "../userBulkService.js";
import { prisma } from "../../../lib/prisma.js";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserFindMany = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockActivityLogCreateMany = jest.fn();
const mockTransaction = jest.fn();

(prisma.user as unknown as Record<string, jest.Mock>).findMany = mockUserFindMany;
(prisma as unknown as Record<string, jest.Mock>).$transaction = mockTransaction;

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
  // mockTransaction receives an async callback; execute it with a fake tx
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
    const fakeTx = {
      user: { updateMany: mockUserUpdateMany },
      activityLog: { createMany: mockActivityLogCreateMany },
    };
    return fn(fakeTx);
  });
  mockUserUpdateMany.mockResolvedValue({ count: 0 });
  mockActivityLogCreateMany.mockResolvedValue({ count: 0 });
});

// ═══════════════════════════════════════════════════════════════
// bulkAction - activate
// ═══════════════════════════════════════════════════════════════
describe("UserBulkService.bulkAction — activate", () => {
  it("should activate multiple inactive users", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-1", isActive: false, isAdmin: false },
      { id: "user-2", isActive: false, isAdmin: false },
    ]);

    const result = await UserBulkService.bulkAction(["user-1", "user-2"], "activate", "admin-1");

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-1", "user-2"] } },
      data: { isActive: true },
    });
  });

  it("should report error for already active user", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-1", isActive: true, isAdmin: false }]);

    const result = await UserBulkService.bulkAction(["user-1"], "activate", "admin-1");

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toContain("déjà actif");
  });

  it("should report error for user not found", async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await UserBulkService.bulkAction(["nonexistent"], "activate", "admin-1");

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].userId).toBe("nonexistent");
    expect(result.errors[0].error).toContain("introuvable");
  });
});

// ═══════════════════════════════════════════════════════════════
// bulkAction - deactivate
// ═══════════════════════════════════════════════════════════════
describe("UserBulkService.bulkAction — deactivate", () => {
  it("should deactivate multiple active non-admin users", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-1", isActive: true, isAdmin: false },
      { id: "user-2", isActive: true, isAdmin: false },
    ]);

    const result = await UserBulkService.bulkAction(["user-1", "user-2"], "deactivate", "admin-1");

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("should reject deactivating an admin user", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "admin-2", isActive: true, isAdmin: true }]);

    const result = await UserBulkService.bulkAction(["admin-2"], "deactivate", "admin-1");

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toContain("administrateur");
  });

  it("should report error for already inactive user", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-1", isActive: false, isAdmin: false }]);

    const result = await UserBulkService.bulkAction(["user-1"], "deactivate", "admin-1");

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toContain("déjà inactif");
  });
});

// ═══════════════════════════════════════════════════════════════
// bulkAction - mixed results & edge cases
// ═══════════════════════════════════════════════════════════════
describe("UserBulkService.bulkAction — mixed & edge cases", () => {
  it("should collect individual errors for mixed results", async () => {
    mockUserFindMany.mockResolvedValue([
      { id: "user-1", isActive: false, isAdmin: false },
      { id: "user-3", isActive: false, isAdmin: false },
    ]);

    const result = await UserBulkService.bulkAction(
      ["user-1", "nonexistent", "user-3"],
      "activate",
      "admin-1",
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].userId).toBe("nonexistent");
  });

  it("should handle empty userIds array", async () => {
    mockUserFindMany.mockResolvedValue([]);

    const result = await UserBulkService.bulkAction([], "activate", "admin-1");

    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should catch unexpected errors during findMany", async () => {
    mockUserFindMany.mockRejectedValue(new Error("DB connection failed"));

    await expect(UserBulkService.bulkAction(["user-1"], "activate", "admin-1")).rejects.toThrow(
      "DB connection failed",
    );
  });

  it("should create audit logs for each successful action", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-1", isActive: true, isAdmin: false }]);

    await UserBulkService.bulkAction(["user-1"], "deactivate", "admin-1");

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockActivityLogCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "admin-1",
          action: "ADMIN_BULK_DEACTIVATE",
          entityId: "user-1",
        }),
      ],
    });
  });
});
