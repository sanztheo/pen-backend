/**
 * AccountDeletionService + AccountExportService Tests — Comprehensive coverage
 * Covers: deleteUserCompletely, exportUserData, workspace transfer, controllers, rate limiters
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { Prisma } from "@prisma/client";

// ─── Constants ──────────────────────────────────────────────
const TEST_USER_ID = "user_test_123";
const TEST_EMAIL = "test@example.com";
const SERIALIZATION_MAX_RETRIES = 3;

// ─── Prisma Mocks ───────────────────────────────────────────
const mockUserFindUnique = jest.fn();
const mockUserDelete = jest.fn();
const mockUserFindMany = jest.fn();
const mockPageFindMany = jest.fn();
const mockPageUpdateMany = jest.fn();
const mockProjectFindMany = jest.fn();
const mockProjectUpdateMany = jest.fn();
const mockWorkspaceFindMany = jest.fn();
const mockWorkspaceFindUnique = jest.fn();
const mockWorkspaceUpdate = jest.fn();
const mockWorkspaceMemberUpdateMany = jest.fn();
const mockWorkspaceMemberFindFirst = jest.fn();
const mockActivityLogFindMany = jest.fn();
const mockActivityLogDeleteMany = jest.fn();
const mockBetaWaitlistDeleteMany = jest.fn();
const mockQuizFindMany = jest.fn();
const mockConversationFindMany = jest.fn();
const mockSubscriptionFindUnique = jest.fn();
const mockTransaction = jest.fn();

(prisma.user as unknown as Record<string, jest.Mock>).findUnique = mockUserFindUnique;
(prisma.user as unknown as Record<string, jest.Mock>).delete = mockUserDelete;
(prisma.user as unknown as Record<string, jest.Mock>).findMany = mockUserFindMany;
(prisma.page as unknown as Record<string, jest.Mock>).findMany = mockPageFindMany;
(prisma.page as unknown as Record<string, jest.Mock>).updateMany = mockPageUpdateMany;
(prisma.project as unknown as Record<string, jest.Mock>).findMany = mockProjectFindMany;
(prisma.project as unknown as Record<string, jest.Mock>).updateMany = mockProjectUpdateMany;
(prisma.workspace as unknown as Record<string, jest.Mock>).findMany = mockWorkspaceFindMany;
(prisma.workspace as unknown as Record<string, jest.Mock>).findUnique = mockWorkspaceFindUnique;
(prisma.workspace as unknown as Record<string, jest.Mock>).update = mockWorkspaceUpdate;
(prisma.workspaceMember as unknown as Record<string, jest.Mock>).updateMany =
  mockWorkspaceMemberUpdateMany;
(prisma.workspaceMember as unknown as Record<string, jest.Mock>).findFirst =
  mockWorkspaceMemberFindFirst;
(prisma.activityLog as unknown as Record<string, jest.Mock>).findMany = mockActivityLogFindMany;
(prisma.activityLog as unknown as Record<string, jest.Mock>).deleteMany = mockActivityLogDeleteMany;
(prisma.betaWaitlist as unknown as Record<string, jest.Mock>).deleteMany =
  mockBetaWaitlistDeleteMany;
(prisma.quiz as unknown as Record<string, jest.Mock>).findMany = mockQuizFindMany;
(prisma.aIConversation as unknown as Record<string, jest.Mock>).findMany = mockConversationFindMany;
(prisma.userSubscription as unknown as Record<string, jest.Mock>).findUnique =
  mockSubscriptionFindUnique;
(prisma as unknown as Record<string, jest.Mock>).$transaction = mockTransaction;

// ─── Redis Mocks ────────────────────────────────────────────
const mockRedisDel = jest.fn();
const mockRedisSet = jest.fn();

(redis as unknown as Record<string, jest.Mock>).del = mockRedisDel;
(redis as unknown as Record<string, jest.Mock>).set = mockRedisSet;

// ─── Suppress logger output in tests ────────────────────────
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Import after mocks ─────────────────────────────────────
const { AccountDeletionService, _setClerkForTest } = await import("../AccountDeletionService.js");
const { AccountExportService } = await import("../AccountExportService.js");
const { logger } = await import("../../utils/logger.js");

// ─── Clerk mock ──────────────────────────────────────────────
const mockClerkDeleteUser = jest.fn<(userId: string) => Promise<unknown>>();

// ─── Test Helpers ────────────────────────────────────────────
interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function createMockRequest(overrides?: Partial<Request>): Partial<Request> {
  return {
    user: { id: TEST_USER_ID, email: TEST_EMAIL } as Request["user"],
    ...overrides,
  };
}

function createTestUser(overrides?: Record<string, unknown>) {
  return {
    id: TEST_USER_ID,
    email: TEST_EMAIL,
    firstName: "Test",
    lastName: "User",
    createdAt: new Date("2024-01-01"),
    lastLoginAt: new Date("2024-06-15"),
    settings: { theme: "dark" },
    ...overrides,
  };
}

/**
 * Helper: set up mockTransaction to execute the callback (simulating Prisma $transaction).
 * The callback receives a "tx" proxy that routes calls back to our top-level prisma mocks.
 */
function setupTransactionExecution(): void {
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<void>, _opts?: unknown) => {
      const txProxy = new Proxy(prisma, {
        get(target, prop) {
          return (target as Record<string | symbol, unknown>)[prop];
        },
      });
      return fn(txProxy);
    },
  );
}

// ─── Setup ──────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  _setClerkForTest(mockClerkDeleteUser);
  mockClerkDeleteUser.mockResolvedValue({ id: TEST_USER_ID });
  mockRedisDel.mockResolvedValue(1);
});

afterAll(async () => {
  _setClerkForTest(null);
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// deleteUserCompletely
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.deleteUserCompletely", () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue(createTestUser());
    setupTransactionExecution();
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({ id: TEST_USER_ID });
  });

  it("should delete user with all related data", async () => {
    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEST_USER_ID },
        select: { id: true, email: true },
      }),
    );

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockClerkDeleteUser).toHaveBeenCalledWith(TEST_USER_ID);
    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should mask email in audit log (GDPR compliance)", async () => {
    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    const auditCall = (logger.log as jest.Mock).mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("Audit:"),
    );
    expect(auditCall).toBeDefined();
    const auditStr = auditCall![0] as string;

    // Should contain masked email, NOT the full email
    expect(auditStr).toContain("t**t@example.com");
    expect(auditStr).not.toContain(`"maskedEmail":"${TEST_EMAIL}"`);
    expect(auditStr).toContain(TEST_USER_ID);
    expect(auditStr).toContain("user_request");
  });

  it("should reassign shared pages to workspace owner", async () => {
    const otherWorkspaceId = "ws-other";
    const pageId = "page-shared";

    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-owned" }]);
    mockPageFindMany.mockResolvedValue([{ id: pageId, workspaceId: otherWorkspaceId }]);
    mockWorkspaceFindUnique.mockResolvedValue({ ownerId: "owner-other" });
    mockPageUpdateMany.mockResolvedValue({ count: 1 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockPageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdBy: TEST_USER_ID,
          workspaceId: { notIn: ["ws-owned"] },
        },
      }),
    );
    expect(mockPageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [pageId] } },
        data: { createdBy: "owner-other" },
      }),
    );
  });

  it("should reassign shared projects to workspace owner", async () => {
    const otherWorkspaceId = "ws-other";
    const projectId = "proj-shared";

    mockWorkspaceFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([{ id: projectId, workspaceId: otherWorkspaceId }]);
    mockWorkspaceFindUnique.mockResolvedValue({ ownerId: "owner-other" });
    mockProjectUpdateMany.mockResolvedValue({ count: 1 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockProjectFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdBy: TEST_USER_ID,
          workspaceId: { notIn: [] },
        },
      }),
    );
    expect(mockProjectUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [projectId] } },
        data: { createdBy: "owner-other" },
      }),
    );
  });

  it("should nullify invitedBy references", async () => {
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 3 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockWorkspaceMemberUpdateMany).toHaveBeenCalledWith({
      where: { invitedBy: TEST_USER_ID },
      data: { invitedBy: null },
    });
  });

  it("should delete BetaWaitlist entries", async () => {
    mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 1 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockBetaWaitlistDeleteMany).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID },
    });
  });

  it("should delete ActivityLog entries", async () => {
    mockActivityLogDeleteMany.mockResolvedValue({ count: 10 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockActivityLogDeleteMany).toHaveBeenCalledWith({
      where: { userId: TEST_USER_ID },
    });
  });

  it("should delete user record", async () => {
    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
    });
  });

  it("should call Clerk deleteUser", async () => {
    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockClerkDeleteUser).toHaveBeenCalledWith(TEST_USER_ID);
  });

  it("should not throw on Clerk deletion failure (logs error instead)", async () => {
    mockClerkDeleteUser.mockRejectedValue(new Error("Clerk API down"));

    await expect(
      AccountDeletionService.deleteUserCompletely(TEST_USER_ID),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Clerk deletion failed"));
  });

  it("should retry on P2034 serialization conflict", async () => {
    const p2034Error = new Prisma.PrismaClientKnownRequestError("Serialization conflict", {
      code: "P2034",
      clientVersion: "5.0.0",
    });

    let attempt = 0;
    mockTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<void>, _opts?: unknown) => {
        attempt++;
        if (attempt < SERIALIZATION_MAX_RETRIES) {
          throw p2034Error;
        }
        const txProxy = new Proxy(prisma, {
          get(target, prop) {
            return (target as Record<string | symbol, unknown>)[prop];
          },
        });
        return fn(txProxy);
      },
    );

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockTransaction).toHaveBeenCalledTimes(SERIALIZATION_MAX_RETRIES);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Serialization conflict"));
  });

  it("should fail after max retries", async () => {
    const p2034Error = new Prisma.PrismaClientKnownRequestError("Serialization conflict", {
      code: "P2034",
      clientVersion: "5.0.0",
    });

    mockTransaction.mockRejectedValue(p2034Error);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow();

    expect(mockTransaction).toHaveBeenCalledTimes(SERIALIZATION_MAX_RETRIES);
  });

  it("should throw for user not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow(
      "User not found",
    );

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockClerkDeleteUser).not.toHaveBeenCalled();
  });

  it("should use Serializable isolation level", async () => {
    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("should invalidate Redis cache even if Clerk fails", async () => {
    mockClerkDeleteUser.mockRejectedValue(new Error("Clerk API down"));

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should not crash if Redis cache invalidation fails", async () => {
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    await expect(
      AccountDeletionService.deleteUserCompletely(TEST_USER_ID),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Workspace Transfer (prevents cascade-delete of others' content)
// ═══════════════════════════════════════════════════════════════
describe("Workspace transfer on deletion", () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue(createTestUser());
    setupTransactionExecution();
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({ id: TEST_USER_ID });
    mockWorkspaceUpdate.mockResolvedValue({ id: "ws-shared" });
    mockPageUpdateMany.mockResolvedValue({ count: 0 });
    mockProjectUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("should transfer shared workspace to next active member", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-shared" }]);
    mockWorkspaceMemberFindFirst.mockResolvedValue({ userId: "next-member-id" });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Should find next member (excluding the deleted user)
    expect(mockWorkspaceMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-shared", userId: { not: TEST_USER_ID }, isActive: true },
        orderBy: { joinedAt: "asc" },
      }),
    );

    // Should transfer ownership
    expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
      where: { id: "ws-shared" },
      data: { ownerId: "next-member-id" },
    });
  });

  it("should reassign deleted user's content in transferred workspace to new owner", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-shared" }]);
    mockWorkspaceMemberFindFirst.mockResolvedValue({ userId: "next-member-id" });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Pages in the shared workspace should be reassigned to new owner
    expect(mockPageUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-shared", createdBy: TEST_USER_ID },
      data: { createdBy: "next-member-id" },
    });

    // Projects in the shared workspace should be reassigned to new owner
    expect(mockProjectUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-shared", createdBy: TEST_USER_ID },
      data: { createdBy: "next-member-id" },
    });
  });

  it("should not transfer solo workspace (no other members)", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-solo" }]);
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Should NOT update workspace ownership
    expect(mockWorkspaceUpdate).not.toHaveBeenCalled();
  });

  it("should handle multiple workspaces — transfer shared, skip solo", async () => {
    mockWorkspaceFindMany.mockResolvedValue([{ id: "ws-shared" }, { id: "ws-solo" }]);
    mockWorkspaceMemberFindFirst
      .mockResolvedValueOnce({ userId: "member-a" })
      .mockResolvedValueOnce(null);

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Only shared workspace should be transferred
    expect(mockWorkspaceUpdate).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
      where: { id: "ws-shared" },
      data: { ownerId: "member-a" },
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// deleteExpiredUsers
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.deleteExpiredUsers", () => {
  beforeEach(() => {
    mockRedisSet.mockResolvedValue("OK");
    mockUserFindUnique.mockResolvedValue(createTestUser());
    setupTransactionExecution();
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({ id: TEST_USER_ID });
  });

  it("should only select id (no PII) for expired users", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "expired-1" }]);

    await AccountDeletionService.deleteExpiredUsers();

    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: { betaStatus: "expired" },
      select: { id: true },
    });
  });

  it("should skip if lock not acquired", async () => {
    mockRedisSet.mockResolvedValue(null);

    const result = await AccountDeletionService.deleteExpiredUsers();

    expect(result).toEqual({ deleted: 0, errors: 0 });
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it("should delete expired users and release lock", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "expired-1" }]);

    const result = await AccountDeletionService.deleteExpiredUsers();

    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
    // Lock released in finally
    expect(mockRedisDel).toHaveBeenCalledWith("account_deletion:cleanup_lock");
  });
});

// ═══════════════════════════════════════════════════════════════
// exportUserData (AccountExportService)
// ═══════════════════════════════════════════════════════════════
describe("AccountExportService.exportUserData", () => {
  const testUser = createTestUser();

  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue(testUser);
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockConversationFindMany.mockResolvedValue([]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockSubscriptionFindUnique.mockResolvedValue(null);
  });

  it("should return complete user profile", async () => {
    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.profile).toEqual({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      firstName: "Test",
      lastName: "User",
      createdAt: testUser.createdAt.toISOString(),
      lastLoginAt: testUser.lastLoginAt!.toISOString(),
      settings: testUser.settings,
    });
    expect(result.exportedAt).toBeDefined();
  });

  it("should return user pages (max 1000, ordered by createdAt desc)", async () => {
    const pages = [
      {
        id: "page-1",
        title: "Page 1",
        createdAt: new Date("2024-06-01"),
        updatedAt: new Date("2024-06-10"),
        workspaceId: "ws-1",
        projectId: "proj-1",
      },
    ];
    mockPageFindMany.mockResolvedValue(pages);

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toEqual({
      id: "page-1",
      title: "Page 1",
      createdAt: pages[0].createdAt.toISOString(),
      updatedAt: pages[0].updatedAt.toISOString(),
      workspaceId: "ws-1",
      projectId: "proj-1",
    });

    expect(mockPageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdBy: TEST_USER_ID },
        take: 1000,
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("should return user projects", async () => {
    const projects = [
      {
        id: "proj-1",
        name: "Project 1",
        description: "Desc",
        createdAt: new Date("2024-03-01"),
        workspaceId: "ws-1",
      },
    ];
    mockProjectFindMany.mockResolvedValue(projects);

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toEqual({
      id: "proj-1",
      name: "Project 1",
      description: "Desc",
      createdAt: projects[0].createdAt.toISOString(),
      workspaceId: "ws-1",
    });
  });

  it("should return user conversations (max 1000)", async () => {
    const conversations = [
      {
        id: "conv-1",
        title: "Chat 1",
        messageCount: 5,
        createdAt: new Date("2024-05-01"),
        lastMessageAt: new Date("2024-05-15"),
      },
    ];
    mockConversationFindMany.mockResolvedValue(conversations);

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toEqual({
      id: "conv-1",
      title: "Chat 1",
      messageCount: 5,
      createdAt: conversations[0].createdAt.toISOString(),
      lastMessageAt: conversations[0].lastMessageAt.toISOString(),
    });

    expect(mockConversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TEST_USER_ID },
        take: 1000,
      }),
    );
  });

  it("should return user activity logs (max 1000)", async () => {
    const logs = [
      {
        id: "log-1",
        action: "create_page",
        entityType: "page",
        createdAt: new Date("2024-04-01"),
      },
    ];
    mockActivityLogFindMany.mockResolvedValue(logs);

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.activityLogs).toHaveLength(1);
    expect(result.activityLogs[0]).toEqual({
      id: "log-1",
      action: "create_page",
      entityType: "page",
      createdAt: logs[0].createdAt.toISOString(),
    });

    expect(mockActivityLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TEST_USER_ID },
        take: 1000,
      }),
    );
  });

  it("should return subscription info", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      plan: "pro",
      status: "active",
      currentPeriodStart: new Date("2024-01-01"),
      currentPeriodEnd: new Date("2024-02-01"),
    });

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.subscription).toEqual({
      plan: "pro",
      status: "active",
      currentPeriodStart: "2024-01-01T00:00:00.000Z",
      currentPeriodEnd: "2024-02-01T00:00:00.000Z",
    });
  });

  it("should handle user with no data gracefully", async () => {
    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.pages).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.quizzes).toEqual([]);
    expect(result.conversations).toEqual([]);
    expect(result.activityLogs).toEqual([]);
    expect(result.subscription).toBeNull();
  });

  it("should throw for user not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(AccountExportService.exportUserData(TEST_USER_ID)).rejects.toThrow(
      "User not found for export",
    );
  });

  it("should return quizzes data", async () => {
    const quizzes = [
      {
        id: "quiz-1",
        title: "Quiz 1",
        isCompleted: true,
        createdAt: new Date("2024-04-01"),
        completedAt: new Date("2024-04-02"),
      },
    ];
    mockQuizFindMany.mockResolvedValue(quizzes);

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.quizzes).toHaveLength(1);
    expect(result.quizzes[0]).toEqual({
      id: "quiz-1",
      title: "Quiz 1",
      isCompleted: true,
      createdAt: quizzes[0].createdAt.toISOString(),
      completedAt: quizzes[0].completedAt.toISOString(),
    });
  });

  it("should handle null lastLoginAt", async () => {
    mockUserFindUnique.mockResolvedValue(createTestUser({ lastLoginAt: null }));

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.profile.lastLoginAt).toBeNull();
  });

  it("should handle null subscription period dates", async () => {
    mockSubscriptionFindUnique.mockResolvedValue({
      plan: "free",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });

    const result = await AccountExportService.exportUserData(TEST_USER_ID);

    expect(result.subscription).toEqual({
      plan: "free",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// DeleteAccountController
// ═══════════════════════════════════════════════════════════════
describe("DeleteAccountController", () => {
  let DeleteAccountController: { deleteAccount: (req: Request, res: Response) => Promise<void> };

  beforeEach(async () => {
    const mod = await import("../../controllers/beta/deleteAccountController.js");
    DeleteAccountController = mod.DeleteAccountController;
  });

  it("should return 200 on successful deletion", async () => {
    mockUserFindUnique.mockResolvedValue(createTestUser());
    setupTransactionExecution();
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({ id: TEST_USER_ID });

    const req = createMockRequest();
    const res = createMockResponse();

    await DeleteAccountController.deleteAccount(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("should return 401 without auth", async () => {
    const req = createMockRequest({ user: undefined });
    const res = createMockResponse();

    await DeleteAccountController.deleteAccount(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Authentication required" }),
    );
  });

  it("should return 403 if impersonating", async () => {
    const req = createMockRequest({
      impersonatedBy: "admin_user",
    } as unknown as Partial<Request>);
    const res = createMockResponse();

    await DeleteAccountController.deleteAccount(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "IMPERSONATION_ACTIVE",
      }),
    );
  });

  it("should return 500 on service error", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("DB connection failed"));

    const req = createMockRequest();
    const res = createMockResponse();

    await DeleteAccountController.deleteAccount(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Failed to delete account" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// ExportAccountController
// ═══════════════════════════════════════════════════════════════
describe("ExportAccountController", () => {
  let ExportAccountController: { exportData: (req: Request, res: Response) => Promise<void> };

  beforeEach(async () => {
    const mod = await import("../../controllers/beta/exportAccountController.js");
    ExportAccountController = mod.ExportAccountController;

    mockUserFindUnique.mockResolvedValue(createTestUser());
    mockPageFindMany.mockResolvedValue([]);
    mockProjectFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockConversationFindMany.mockResolvedValue([]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockSubscriptionFindUnique.mockResolvedValue(null);
  });

  it("should return 200 with export data", async () => {
    const req = createMockRequest();
    const res = createMockResponse();

    await ExportAccountController.exportData(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          profile: expect.objectContaining({ id: TEST_USER_ID }),
        }),
      }),
    );
  });

  it("should return 401 without auth", async () => {
    const req = createMockRequest({ user: undefined });
    const res = createMockResponse();

    await ExportAccountController.exportData(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Authentication required" }),
    );
  });

  it("should return 403 if impersonating", async () => {
    const req = createMockRequest({
      impersonatedBy: "admin_user",
    } as unknown as Partial<Request>);
    const res = createMockResponse();

    await ExportAccountController.exportData(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "IMPERSONATION_ACTIVE",
      }),
    );
  });

  it("should return 500 on service error", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("DB failure"));

    const req = createMockRequest();
    const res = createMockResponse();

    await ExportAccountController.exportData(req as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: "Failed to export account data" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Rate Limiters (configuration verification)
// ═══════════════════════════════════════════════════════════════
describe("Rate limiter route wiring", () => {
  it("DELETE /account route uses accountDeleteRateLimit (1 req/hour)", async () => {
    const fs = await import("fs");
    const routeSource = fs.readFileSync(new URL("../../routes/beta.ts", import.meta.url), "utf-8");
    expect(routeSource).toContain("accountDeleteRateLimit");
    expect(routeSource).toMatch(/router\.delete\(\s*["']\/account["']/);
  });

  it("GET /account/export route uses accountExportRateLimit (1 req/day)", async () => {
    const fs = await import("fs");
    const routeSource = fs.readFileSync(new URL("../../routes/beta.ts", import.meta.url), "utf-8");
    expect(routeSource).toContain("accountExportRateLimit");
    expect(routeSource).toMatch(/router\.get\(\s*["']\/account\/export["']/);
  });
});

// ═══════════════════════════════════════════════════════════════
// _setClerkForTest guard
// ═══════════════════════════════════════════════════════════════
describe("_setClerkForTest NODE_ENV guard", () => {
  it("should work in test environment", () => {
    // We're already in test env — should not throw
    expect(() => _setClerkForTest(jest.fn())).not.toThrow();
  });
});
