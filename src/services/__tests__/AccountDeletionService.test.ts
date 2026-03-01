/**
 * AccountDeletionService Tests — Phase 8 enterprise-grade coverage
 * Covers: deleteUserCompletely, exportUserData, cron integration, controller guards
 */

import { afterAll, describe, expect, it, jest, beforeEach } from "@jest/globals";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { Prisma } from "@prisma/client";

// ─── Prisma Mocks ───────────────────────────────────────────────
const mockUserFindUnique = jest.fn();
const mockUserFindUniqueOrThrow = jest.fn();
const mockUserDelete = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockUserCount = jest.fn();
const mockActivityLogDeleteMany = jest.fn();
const mockActivityLogFindMany = jest.fn();
const mockPageFindMany = jest.fn();
const mockPageUpdate = jest.fn();
const mockProjectFindMany = jest.fn();
const mockProjectUpdate = jest.fn();
const mockWorkspaceFindMany = jest.fn();
const mockWorkspaceMemberUpdateMany = jest.fn();
const mockQuizFindMany = jest.fn();
const mockAIConversationFindMany = jest.fn();
const mockUserSubscriptionFindUnique = jest.fn();
const mockBetaWaitlistDeleteMany = jest.fn();
const mockTransaction = jest.fn();

/* eslint-disable @typescript-eslint/no-explicit-any */
(prisma.user as any).findUnique = mockUserFindUnique;
(prisma.user as any).findUniqueOrThrow = mockUserFindUniqueOrThrow;
(prisma.user as any).delete = mockUserDelete;
(prisma.user as any).findMany = mockUserFindMany;
(prisma.user as any).updateMany = mockUserUpdateMany;
(prisma.user as any).count = mockUserCount;
(prisma.activityLog as any).deleteMany = mockActivityLogDeleteMany;
(prisma.activityLog as any).findMany = mockActivityLogFindMany;
(prisma.page as any).findMany = mockPageFindMany;
(prisma.page as any).update = mockPageUpdate;
(prisma.project as any).findMany = mockProjectFindMany;
(prisma.project as any).update = mockProjectUpdate;
(prisma.workspace as any).findMany = mockWorkspaceFindMany;
(prisma.workspaceMember as any).updateMany = mockWorkspaceMemberUpdateMany;
(prisma.quiz as any).findMany = mockQuizFindMany;
(prisma.aIConversation as any).findMany = mockAIConversationFindMany;
(prisma.userSubscription as any).findUnique = mockUserSubscriptionFindUnique;
(prisma.betaWaitlist as any).deleteMany = mockBetaWaitlistDeleteMany;
(prisma as any).$transaction = mockTransaction;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Redis Mocks ────────────────────────────────────────────────
const mockRedisDel = jest.fn();
const mockRedisScan = jest.fn();
const mockRedisSet = jest.fn();

/* eslint-disable @typescript-eslint/no-explicit-any */
(redis as any).del = mockRedisDel;
(redis as any).scan = mockRedisScan;
(redis as any).set = mockRedisSet;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Clerk Mock ─────────────────────────────────────────────────
const mockClerkDeleteUser = jest.fn();

jest.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      deleteUser: mockClerkDeleteUser,
    },
  }),
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

// ─── Import service (jest.mock is hoisted above imports) ─────────
import { AccountDeletionService } from "../AccountDeletionService.js";

// ─── Test Helpers ───────────────────────────────────────────────
const TEST_USER_ID = "user-delete-001";
const TEST_DATE = new Date("2026-02-06T12:00:00Z");

const makeMockUser = (overrides: Record<string, unknown> = {}) => ({
  email: "delete-me@test.com",
  betaStatus: "active",
  createdAt: TEST_DATE,
  subscription: { plan: "free" },
  ...overrides,
});

/**
 * Sets up mockTransaction to execute the callback passed to $transaction.
 * Provides a mock transactional client with the same mock fns.
 */
function setupTransactionExecution(): void {
  mockTransaction.mockImplementation(async (callback: unknown) => {
    if (typeof callback === "function") {
      const txClient = {
        activityLog: { deleteMany: mockActivityLogDeleteMany },
        page: { findMany: mockPageFindMany, update: mockPageUpdate },
        project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
        workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
        user: { delete: mockUserDelete },
      };
      return callback(txClient);
    }
    // Batch transaction (array form)
    return callback;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLERK_SECRET_KEY = "sk_test_fake_key";
  mockRedisDel.mockResolvedValue(1);
  mockRedisScan.mockResolvedValue(["0", []]);
  mockRedisSet.mockResolvedValue("OK"); // distributed lock acquired
  // Default: no shared pages/projects
  mockPageFindMany.mockResolvedValue([]);
  mockProjectFindMany.mockResolvedValue([]);
});

afterAll(async () => {
  await redis.disconnect();
});

// ═══════════════════════════════════════════════════════════════
// deleteUserCompletely
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.deleteUserCompletely", () => {
  // Must run FIRST: getClerk() uses a lazy singleton — once initialised, it stays cached
  it("should throw when CLERK_SECRET_KEY is missing", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    delete process.env.CLERK_SECRET_KEY;

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow(
      "CLERK_SECRET_KEY",
    );
  });

  it("should delete user completely (Clerk + DB + cache invalidation)", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 3 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(result.deletedUserId).toBe(TEST_USER_ID);
    expect(result.audit.email).toBe("delete-me@test.com");
    expect(mockClerkDeleteUser).toHaveBeenCalledWith(TEST_USER_ID);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should throw USER_NOT_FOUND when user does not exist", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow(
      "[ACCOUNT_DELETION] User not found",
    );
  });

  it("should continue DB deletion when Clerk user already deleted (404)", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockRejectedValue({ status: 404 });
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("should throw when Clerk returns a non-404 error", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockRejectedValue(new Error("Clerk network error"));

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow(
      "Clerk network error",
    );
  });

  it("should throw on DB constraint error", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    const constraintError = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "5.0.0" },
    );
    mockTransaction.mockRejectedValue(constraintError);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow();
  });

  it("should retry and succeed on P2034 serialization conflict", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    const p2034Error = new Prisma.PrismaClientKnownRequestError("Serialization failure", {
      code: "P2034",
      clientVersion: "5.0.0",
    });

    let callCount = 0;
    mockTransaction.mockImplementation(async (callback: unknown) => {
      callCount++;
      if (callCount === 1) {
        throw p2034Error;
      }
      if (typeof callback === "function") {
        const txClient = {
          activityLog: { deleteMany: mockActivityLogDeleteMany },
          page: { findMany: mockPageFindMany, update: mockPageUpdate },
          project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
          workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
          user: { delete: mockUserDelete },
        };
        return callback(txClient);
      }
    });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  it("should throw after exhausting P2034 retries (3 attempts)", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    const p2034Error = new Prisma.PrismaClientKnownRequestError("Serialization failure", {
      code: "P2034",
      clientVersion: "5.0.0",
    });

    mockTransaction.mockRejectedValue(p2034Error);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow();

    expect(mockTransaction).toHaveBeenCalledTimes(3);
  });

  it("should reassign pages in shared workspace to workspace owner", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        const sharedPages = [
          { id: "page-1", workspace: { ownerId: "owner-A" } },
          { id: "page-2", workspace: { ownerId: "owner-B" } },
        ];
        const txClient = {
          activityLog: { deleteMany: mockActivityLogDeleteMany },
          page: {
            findMany: jest.fn<() => Promise<typeof sharedPages>>().mockResolvedValue(sharedPages),
            update: mockPageUpdate,
          },
          project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
          workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
          user: { delete: mockUserDelete },
        };
        return callback(txClient);
      }
    });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});
    mockProjectFindMany.mockResolvedValue([]);

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { createdBy: "owner-A" },
    });
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: "page-2" },
      data: { createdBy: "owner-B" },
    });
  });

  it("should reassign projects in shared workspace to workspace owner", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        const sharedProjects = [{ id: "proj-1", workspace: { ownerId: "owner-C" } }];
        const txClient = {
          activityLog: { deleteMany: mockActivityLogDeleteMany },
          page: { findMany: mockPageFindMany, update: mockPageUpdate },
          project: {
            findMany: jest
              .fn<() => Promise<typeof sharedProjects>>()
              .mockResolvedValue(sharedProjects),
            update: mockProjectUpdate,
          },
          workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
          user: { delete: mockUserDelete },
        };
        return callback(txClient);
      }
    });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { createdBy: "owner-C" },
    });
  });

  it("should nullify WorkspaceMember.invitedBy references", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 2 });
    mockUserDelete.mockResolvedValue({});

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockWorkspaceMemberUpdateMany).toHaveBeenCalledWith({
      where: { invitedBy: TEST_USER_ID },
      data: { invitedBy: null },
    });
  });

  it("should delete activity logs before user deletion", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    const callOrder: string[] = [];
    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        const txClient = {
          activityLog: {
            deleteMany: jest.fn<() => Promise<{ count: number }>>().mockImplementation(async () => {
              callOrder.push("activityLog.deleteMany");
              return { count: 5 };
            }),
          },
          page: { findMany: mockPageFindMany, update: mockPageUpdate },
          project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
          workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
          user: {
            delete: jest
              .fn<() => Promise<Record<string, unknown>>>()
              .mockImplementation(async () => {
                callOrder.push("user.delete");
                return {};
              }),
          },
        };
        return callback(txClient);
      }
    });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    const activityIdx = callOrder.indexOf("activityLog.deleteMany");
    const userIdx = callOrder.indexOf("user.delete");
    expect(activityIdx).toBeLessThan(userIdx);
  });

  it("should invalidate Redis cache keys after deletion", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should warn but not throw when Redis cache invalidation fails", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
  });

  it("should return USER_NOT_FOUND on double-delete (idempotent)", async () => {
    // First call succeeds
    mockUserFindUnique.mockResolvedValueOnce(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Second call: user no longer exists
    mockUserFindUnique.mockResolvedValueOnce(null);

    await expect(AccountDeletionService.deleteUserCompletely(TEST_USER_ID)).rejects.toThrow(
      "User not found",
    );
  });

  it("should build audit data BEFORE transaction starts", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    // Audit data is populated from the user record fetched before deletion
    expect(result.audit.email).toBe("delete-me@test.com");
    expect(result.audit.betaStatus).toBe("active");
    expect(result.audit.plan).toBe("free");
    expect(result.audit.deletedAt).toBeInstanceOf(Date);
  });
});

// ═══════════════════════════════════════════════════════════════
// exportUserData
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.exportUserData", () => {
  it("should export all user data tables populated", async () => {
    mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: TEST_USER_ID,
      email: "export@test.com",
      firstName: "Test",
      lastName: "User",
      avatarUrl: null,
      createdAt: TEST_DATE,
      lastLoginAt: TEST_DATE,
      betaStatus: "active",
      betaJoinedAt: TEST_DATE,
      onboardingCompleted: true,
      settings: {},
    });
    mockWorkspaceFindMany.mockResolvedValue([
      {
        id: "ws-1",
        name: "My Workspace",
        description: null,
        color: null,
        createdAt: TEST_DATE,
        isArchived: false,
        members: [{ userId: TEST_USER_ID, role: "owner", joinedAt: TEST_DATE }],
      },
    ]);
    mockPageFindMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Test Page",
        createdAt: TEST_DATE,
        updatedAt: TEST_DATE,
        workspaceId: "ws-1",
        projectId: null,
        blockNoteContent: {},
      },
    ]);
    mockQuizFindMany.mockResolvedValue([
      {
        id: "quiz-1",
        title: "Test Quiz",
        createdAt: TEST_DATE,
        isCompleted: true,
        completedAt: TEST_DATE,
        questions: [],
        userAnswers: [],
      },
    ]);
    mockAIConversationFindMany.mockResolvedValue([
      {
        id: "conv-1",
        title: "Test Conv",
        createdAt: TEST_DATE,
        messageCount: 2,
        messages: [
          { id: "msg-1", role: "user", content: "Hello", createdAt: TEST_DATE },
          { id: "msg-2", role: "assistant", content: "Hi", createdAt: TEST_DATE },
        ],
      },
    ]);
    mockActivityLogFindMany.mockResolvedValue([
      {
        id: "log-1",
        action: "PAGE_CREATED",
        entityType: "page",
        entityId: "page-1",
        createdAt: TEST_DATE,
        details: {},
      },
    ]);
    mockUserSubscriptionFindUnique.mockResolvedValue({
      plan: "free",
      status: "active",
      currentPeriodStart: TEST_DATE,
      currentPeriodEnd: TEST_DATE,
    });

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.profile.email).toBe("export@test.com");
    expect(data.workspaces).toHaveLength(1);
    expect(data.pages).toHaveLength(1);
    expect(data.quizzes).toHaveLength(1);
    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].messages).toHaveLength(2);
    expect(data.activityLogs).toHaveLength(1);
    expect(data.subscription).not.toBeNull();
  });

  it("should throw error when user not found for export", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(AccountDeletionService.exportUserData("nonexistent")).rejects.toThrow(
      "User not found for export",
    );
  });

  it("should return valid structure with empty arrays for user with no data", async () => {
    mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: TEST_USER_ID,
      email: "empty@test.com",
      firstName: "Empty",
      lastName: "User",
      avatarUrl: null,
      createdAt: TEST_DATE,
      lastLoginAt: null,
      betaStatus: "active",
      betaJoinedAt: TEST_DATE,
      onboardingCompleted: false,
      settings: {},
    });
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockPageFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockAIConversationFindMany.mockResolvedValue([]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockUserSubscriptionFindUnique.mockResolvedValue(null);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.profile.email).toBe("empty@test.com");
    expect(data.workspaces).toEqual([]);
    expect(data.pages).toEqual([]);
    expect(data.quizzes).toEqual([]);
    expect(data.conversations).toEqual([]);
    expect(data.activityLogs).toEqual([]);
    expect(data.subscription).toBeNull();
  });

  it("should include subscription data in export", async () => {
    mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: TEST_USER_ID,
      email: "sub@test.com",
      firstName: "Sub",
      lastName: "User",
      avatarUrl: null,
      createdAt: TEST_DATE,
      lastLoginAt: TEST_DATE,
      betaStatus: "active",
      betaJoinedAt: TEST_DATE,
      onboardingCompleted: true,
      settings: {},
    });
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockPageFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockAIConversationFindMany.mockResolvedValue([]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockUserSubscriptionFindUnique.mockResolvedValue({
      plan: "pro",
      status: "active",
      currentPeriodStart: TEST_DATE,
      currentPeriodEnd: new Date("2026-03-06T12:00:00Z"),
    });

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.subscription?.plan).toBe("pro");
    expect(data.subscription?.status).toBe("active");
  });

  it("should include AI conversation messages in export", async () => {
    mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: TEST_USER_ID,
      email: "ai@test.com",
      firstName: "AI",
      lastName: "User",
      avatarUrl: null,
      createdAt: TEST_DATE,
      lastLoginAt: TEST_DATE,
      betaStatus: "active",
      betaJoinedAt: TEST_DATE,
      onboardingCompleted: true,
      settings: {},
    });
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockPageFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockAIConversationFindMany.mockResolvedValue([
      {
        id: "conv-2",
        title: "Study Session",
        createdAt: TEST_DATE,
        messageCount: 3,
        messages: [
          { id: "m1", role: "user", content: "Explain DNA", createdAt: TEST_DATE },
          { id: "m2", role: "assistant", content: "DNA is...", createdAt: TEST_DATE },
          { id: "m3", role: "user", content: "Thanks", createdAt: TEST_DATE },
        ],
      },
    ]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockUserSubscriptionFindUnique.mockResolvedValue(null);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].messages).toHaveLength(3);
    expect(data.conversations[0].messages[0].content).toBe("Explain DNA");
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: cron + controllers
// ═══════════════════════════════════════════════════════════════
describe("Integration — cron + controllers", () => {
  describe("BetaCronService feature flag integration", () => {
    it("should skip deletion when ENABLE_ACCOUNT_DELETION is not set", async () => {
      delete process.env.ENABLE_ACCOUNT_DELETION;

      // Import BetaCronService
      const { BetaCronService } = await import("../BetaCronService.js");

      // Mock expired users
      mockUserFindMany.mockResolvedValue([
        { id: "expired-1", email: "e1@test.com", betaReactivationDeadline: new Date("2026-01-01") },
      ]);
      mockUserUpdateMany.mockResolvedValue({ count: 1 });
      mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
      mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);
      mockRedisDel.mockResolvedValue(1);

      const result = await BetaCronService.cleanupExpiredAccounts();

      // Should NOT call deleteUserCompletely
      expect(result.processed).toBe(1);
      expect(mockClerkDeleteUser).not.toHaveBeenCalled();
    });

    it("should call deleteUserCompletely when feature flag is enabled", async () => {
      process.env.ENABLE_ACCOUNT_DELETION = "true";

      const { BetaCronService } = await import("../BetaCronService.js");

      mockUserFindMany.mockResolvedValue([
        { id: "expired-2", email: "e2@test.com", betaReactivationDeadline: new Date("2026-01-01") },
      ]);
      mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);
      mockRedisDel.mockResolvedValue(1);

      // Mock the full deleteUserCompletely chain for the expired user
      mockUserFindUnique.mockResolvedValue(makeMockUser({ email: "e2@test.com" }));
      mockClerkDeleteUser.mockResolvedValue({});
      mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
      mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
      mockUserDelete.mockResolvedValue({});

      // Set up transaction to work for both the batch expiry and the per-user deletion
      mockTransaction.mockImplementation(async (callbackOrArray: unknown) => {
        if (Array.isArray(callbackOrArray)) {
          // Batch expiry transaction
          return [{ count: 1 }, { count: 0 }];
        }
        if (typeof callbackOrArray === "function") {
          const txClient = {
            activityLog: { deleteMany: mockActivityLogDeleteMany },
            page: { findMany: mockPageFindMany, update: mockPageUpdate },
            project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
            workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
            user: { delete: mockUserDelete },
          };
          return callbackOrArray(txClient);
        }
      });

      const result = await BetaCronService.cleanupExpiredAccounts();

      expect(result.processed).toBeGreaterThanOrEqual(1);

      delete process.env.ENABLE_ACCOUNT_DELETION;
    });

    it("should continue with other users when individual deletion fails", async () => {
      process.env.ENABLE_ACCOUNT_DELETION = "true";

      const { BetaCronService } = await import("../BetaCronService.js");

      mockUserFindMany.mockResolvedValue([
        { id: "fail-1", email: "f1@test.com", betaReactivationDeadline: new Date("2026-01-01") },
        { id: "fail-2", email: "f2@test.com", betaReactivationDeadline: new Date("2026-01-01") },
      ]);

      mockTransaction.mockImplementation(async (callbackOrArray: unknown) => {
        if (Array.isArray(callbackOrArray)) {
          return [{ count: 2 }, { count: 0 }];
        }
        if (typeof callbackOrArray === "function") {
          const txClient = {
            activityLog: { deleteMany: mockActivityLogDeleteMany },
            page: { findMany: mockPageFindMany, update: mockPageUpdate },
            project: { findMany: mockProjectFindMany, update: mockProjectUpdate },
            workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
            user: { delete: mockUserDelete },
          };
          return callbackOrArray(txClient);
        }
      });
      mockRedisDel.mockResolvedValue(1);

      // First user fails at findUnique, second succeeds
      mockUserFindUnique
        .mockResolvedValueOnce(null) // fail-1 not found → error
        .mockResolvedValueOnce(makeMockUser({ email: "f2@test.com" })); // fail-2 exists

      mockClerkDeleteUser.mockResolvedValue({});
      mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
      mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
      mockUserDelete.mockResolvedValue({});

      const result = await BetaCronService.cleanupExpiredAccounts();

      // Should have errors > 0 but still process both
      expect(result.errors).toBeGreaterThanOrEqual(1);

      delete process.env.ENABLE_ACCOUNT_DELETION;
    });
  });

  describe("Cron feature flag strict equality", () => {
    const setupCronMocks = (): void => {
      mockUserFindMany.mockResolvedValue([
        {
          id: "flag-user",
          email: "flag@test.com",
          betaReactivationDeadline: new Date("2026-01-01"),
        },
      ]);
      mockTransaction.mockResolvedValue([{ count: 1 }, { count: 0 }]);
      mockRedisDel.mockResolvedValue(1);
      mockBetaWaitlistDeleteMany.mockResolvedValue({ count: 0 });
    };

    it.each([
      ["TRUE", "uppercase TRUE"],
      ["1", "truthy string 1"],
      ["false", "explicit false"],
      ["", "empty string"],
    ])(
      "should NOT trigger deletion when ENABLE_ACCOUNT_DELETION=%s (%s)",
      async (flagValue: string) => {
        process.env.ENABLE_ACCOUNT_DELETION = flagValue;
        setupCronMocks();

        const { BetaCronService } = await import("../BetaCronService.js");
        await BetaCronService.cleanupExpiredAccounts();

        expect(mockClerkDeleteUser).not.toHaveBeenCalled();

        delete process.env.ENABLE_ACCOUNT_DELETION;
      },
    );
  });

  describe("Controller guards", () => {
    it("should reject self-delete with impersonation (403)", async () => {
      const { DeleteAccountController } =
        await import("../../controllers/beta/deleteAccountController.js");

      const req = {
        user: { id: TEST_USER_ID },
        impersonatedBy: "admin-user",
      } as unknown as import("express").Request;

      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await DeleteAccountController.deleteAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(403);
      expect(resJson).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "IMPERSONATION_BLOCKED",
        }),
      );
    });

    it("should reject self-delete without auth (401)", async () => {
      const { DeleteAccountController } =
        await import("../../controllers/beta/deleteAccountController.js");

      const req = { user: undefined } as unknown as import("express").Request;

      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await DeleteAccountController.deleteAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(401);
    });

    it("should reject export without auth (401)", async () => {
      const { ExportAccountController } =
        await import("../../controllers/beta/exportAccountController.js");

      const req = { user: undefined } as unknown as import("express").Request;

      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await ExportAccountController.exportAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(401);
    });
  });

  describe("Controller success paths + error propagation", () => {
    it("should return 200 on successful account deletion", async () => {
      const { DeleteAccountController } =
        await import("../../controllers/beta/deleteAccountController.js");

      mockUserFindUnique.mockResolvedValue(makeMockUser());
      mockClerkDeleteUser.mockResolvedValue({});
      setupTransactionExecution();
      mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
      mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
      mockUserDelete.mockResolvedValue({});

      const req = { user: { id: TEST_USER_ID } } as unknown as import("express").Request;
      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await DeleteAccountController.deleteAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(200);
      expect(resJson).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: "Account deleted" }),
      );
    });

    it("should return 500 when deletion service throws", async () => {
      const { DeleteAccountController } =
        await import("../../controllers/beta/deleteAccountController.js");

      mockUserFindUnique.mockRejectedValue(new Error("DB connection lost"));

      const req = { user: { id: TEST_USER_ID } } as unknown as import("express").Request;
      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await DeleteAccountController.deleteAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(500);
      expect(resJson).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: "Failed to delete account" }),
      );
    });

    it("should return 200 with data on successful export", async () => {
      const { ExportAccountController } =
        await import("../../controllers/beta/exportAccountController.js");

      mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
      mockUserFindUniqueOrThrow.mockResolvedValue({
        id: TEST_USER_ID,
        email: "ctrl@test.com",
        firstName: "C",
        lastName: "T",
        avatarUrl: null,
        createdAt: TEST_DATE,
        lastLoginAt: null,
        betaStatus: "active",
        betaJoinedAt: TEST_DATE,
        onboardingCompleted: false,
        settings: {},
      });
      mockWorkspaceFindMany.mockResolvedValue([]);
      mockPageFindMany.mockResolvedValue([]);
      mockQuizFindMany.mockResolvedValue([]);
      mockAIConversationFindMany.mockResolvedValue([]);
      mockActivityLogFindMany.mockResolvedValue([]);
      mockUserSubscriptionFindUnique.mockResolvedValue(null);

      const req = { user: { id: TEST_USER_ID } } as unknown as import("express").Request;
      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await ExportAccountController.exportAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(200);
      expect(resJson).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            profile: expect.objectContaining({ email: "ctrl@test.com" }),
          }),
        }),
      );
    });

    it("should return 500 when export service throws", async () => {
      const { ExportAccountController } =
        await import("../../controllers/beta/exportAccountController.js");

      mockUserFindUnique.mockRejectedValue(new Error("DB timeout"));

      const req = { user: { id: TEST_USER_ID } } as unknown as import("express").Request;
      const resJson = jest.fn();
      const resStatus = jest
        .fn<() => { json: typeof resJson }>()
        .mockReturnValue({ json: resJson });
      const res = { status: resStatus, json: resJson } as unknown as import("express").Response;

      await ExportAccountController.exportAccount(req, res);

      expect(resStatus).toHaveBeenCalledWith(500);
      expect(resJson).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: "Failed to export account data" }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage: deletion edge cases
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.deleteUserCompletely — additional edge cases", () => {
  it("should set audit.plan to null when user has no subscription", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser({ subscription: null }));
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.audit.plan).toBeNull();
  });

  it("should reassign both shared pages and projects in a single transaction", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});

    mockTransaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === "function") {
        const sharedPages = [{ id: "page-shared-1", workspace: { ownerId: "owner-X" } }];
        const sharedProjects = [{ id: "proj-shared-1", workspace: { ownerId: "owner-Y" } }];
        const txClient = {
          activityLog: { deleteMany: mockActivityLogDeleteMany },
          page: {
            findMany: jest.fn<() => Promise<typeof sharedPages>>().mockResolvedValue(sharedPages),
            update: mockPageUpdate,
          },
          project: {
            findMany: jest
              .fn<() => Promise<typeof sharedProjects>>()
              .mockResolvedValue(sharedProjects),
            update: mockProjectUpdate,
          },
          workspaceMember: { updateMany: mockWorkspaceMemberUpdateMany },
          user: { delete: mockUserDelete },
        };
        return callback(txClient);
      }
    });
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    const result = await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(result.success).toBe(true);
    expect(mockPageUpdate).toHaveBeenCalledWith({
      where: { id: "page-shared-1" },
      data: { createdBy: "owner-X" },
    });
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: "proj-shared-1" },
      data: { createdBy: "owner-Y" },
    });
  });

  it("should delete Redis admin metrics keys found by SCAN", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    mockRedisScan.mockResolvedValue([
      "0",
      ["admin:beta:metrics:daily", "admin:beta:metrics:weekly"],
    ]);

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
    expect(mockRedisDel).toHaveBeenCalledWith(
      "admin:beta:metrics:daily",
      "admin:beta:metrics:weekly",
    );
  });

  it("should not call redis.del for metrics when SCAN returns empty", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});
    mockRedisScan.mockResolvedValue(["0", []]);

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith("beta:active_count");
  });

  it("should handle multiple SCAN iterations before cursor returns to 0", async () => {
    mockUserFindUnique.mockResolvedValue(makeMockUser());
    mockClerkDeleteUser.mockResolvedValue({});
    setupTransactionExecution();
    mockActivityLogDeleteMany.mockResolvedValue({ count: 0 });
    mockWorkspaceMemberUpdateMany.mockResolvedValue({ count: 0 });
    mockUserDelete.mockResolvedValue({});

    // First SCAN returns cursor "42" with one key, second returns "0" with another
    mockRedisScan
      .mockResolvedValueOnce(["42", ["admin:beta:metrics:a"]])
      .mockResolvedValueOnce(["0", ["admin:beta:metrics:b"]]);

    await AccountDeletionService.deleteUserCompletely(TEST_USER_ID);

    expect(mockRedisScan).toHaveBeenCalledTimes(2);
    expect(mockRedisDel).toHaveBeenCalledWith("admin:beta:metrics:a", "admin:beta:metrics:b");
  });
});

// ═══════════════════════════════════════════════════════════════
// Additional coverage: export data shape validation
// ═══════════════════════════════════════════════════════════════
describe("AccountDeletionService.exportUserData — data shape validation", () => {
  const setupExportMocks = (overrides: Record<string, unknown> = {}): void => {
    mockUserFindUnique.mockResolvedValue({ id: TEST_USER_ID });
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: TEST_USER_ID,
      email: "shape@test.com",
      firstName: "Shape",
      lastName: "Test",
      avatarUrl: null,
      createdAt: TEST_DATE,
      lastLoginAt: null,
      betaStatus: "active",
      betaJoinedAt: TEST_DATE,
      onboardingCompleted: false,
      settings: { theme: "dark" },
      ...overrides,
    });
    mockWorkspaceFindMany.mockResolvedValue([]);
    mockPageFindMany.mockResolvedValue([]);
    mockQuizFindMany.mockResolvedValue([]);
    mockAIConversationFindMany.mockResolvedValue([]);
    mockActivityLogFindMany.mockResolvedValue([]);
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
  };

  it("should preserve null fields in profile (avatarUrl, lastLoginAt)", async () => {
    setupExportMocks();

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.profile.avatarUrl).toBeNull();
    expect(data.profile.lastLoginAt).toBeNull();
  });

  it("should preserve Date instances in profile", async () => {
    setupExportMocks();

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.profile.createdAt).toBeInstanceOf(Date);
    expect(data.profile.betaJoinedAt).toBeInstanceOf(Date);
  });

  it("should include settings object in profile", async () => {
    setupExportMocks();

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.profile.settings).toEqual({ theme: "dark" });
  });

  it("should include blockNoteContent and null projectId in exported pages", async () => {
    setupExportMocks();
    const blockContent = { type: "doc", content: [{ type: "paragraph" }] };
    mockPageFindMany.mockResolvedValue([
      {
        id: "page-bn",
        title: "BlockNote Page",
        createdAt: TEST_DATE,
        updatedAt: TEST_DATE,
        workspaceId: "ws-1",
        projectId: null,
        blockNoteContent: blockContent,
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.pages[0].blockNoteContent).toEqual(blockContent);
    expect(data.pages[0].projectId).toBeNull();
  });

  it("should include quiz questions and userAnswers in export", async () => {
    setupExportMocks();
    const questions = [{ q: "What is DNA?", options: ["A", "B"] }];
    const answers = [{ questionIndex: 0, answer: "A", correct: true }];
    mockQuizFindMany.mockResolvedValue([
      {
        id: "quiz-shape",
        title: "Bio Quiz",
        createdAt: TEST_DATE,
        isCompleted: true,
        completedAt: TEST_DATE,
        questions,
        userAnswers: answers,
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.quizzes[0].questions).toEqual(questions);
    expect(data.quizzes[0].userAnswers).toEqual(answers);
    expect(data.quizzes[0].completedAt).toBeInstanceOf(Date);
  });

  it("should include workspace members with roles in export", async () => {
    setupExportMocks();
    mockWorkspaceFindMany.mockResolvedValue([
      {
        id: "ws-multi",
        name: "Team Workspace",
        description: "A team ws",
        color: "#ff0000",
        createdAt: TEST_DATE,
        isArchived: false,
        members: [
          { userId: TEST_USER_ID, role: "owner", joinedAt: TEST_DATE },
          { userId: "member-2", role: "editor", joinedAt: TEST_DATE },
        ],
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.workspaces[0].members).toHaveLength(2);
    expect(data.workspaces[0].members[0].role).toBe("owner");
    expect(data.workspaces[0].members[1].role).toBe("editor");
    expect(data.workspaces[0].description).toBe("A team ws");
    expect(data.workspaces[0].color).toBe("#ff0000");
  });

  it("should include activity log details in export", async () => {
    setupExportMocks();
    const logDetails = { pageTitle: "Old Title", newTitle: "New Title" };
    mockActivityLogFindMany.mockResolvedValue([
      {
        id: "log-detail",
        action: "PAGE_RENAMED",
        entityType: "page",
        entityId: "page-99",
        createdAt: TEST_DATE,
        details: logDetails,
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.activityLogs[0].details).toEqual(logDetails);
    expect(data.activityLogs[0].action).toBe("PAGE_RENAMED");
  });

  it("should export quiz with null completedAt when not completed", async () => {
    setupExportMocks();
    mockQuizFindMany.mockResolvedValue([
      {
        id: "quiz-incomplete",
        title: "Unfinished Quiz",
        createdAt: TEST_DATE,
        isCompleted: false,
        completedAt: null,
        questions: [],
        userAnswers: [],
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.quizzes[0].isCompleted).toBe(false);
    expect(data.quizzes[0].completedAt).toBeNull();
    expect(data.quizzes[0].questions).toEqual([]);
    expect(data.quizzes[0].userAnswers).toEqual([]);
  });

  it("should export multiple workspaces including archived ones", async () => {
    setupExportMocks();
    mockWorkspaceFindMany.mockResolvedValue([
      {
        id: "ws-active",
        name: "Active WS",
        description: null,
        color: null,
        createdAt: TEST_DATE,
        isArchived: false,
        members: [{ userId: TEST_USER_ID, role: "owner", joinedAt: TEST_DATE }],
      },
      {
        id: "ws-archived",
        name: "Archived WS",
        description: null,
        color: null,
        createdAt: TEST_DATE,
        isArchived: true,
        members: [{ userId: TEST_USER_ID, role: "owner", joinedAt: TEST_DATE }],
      },
    ]);

    const data = await AccountDeletionService.exportUserData(TEST_USER_ID);

    expect(data.workspaces).toHaveLength(2);
    expect(data.workspaces[0].isArchived).toBe(false);
    expect(data.workspaces[1].isArchived).toBe(true);
  });
});
