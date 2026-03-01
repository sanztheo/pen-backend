import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { createClerkClient } from "@clerk/backend";
import { Prisma } from "@prisma/client";

import { DELETION_MAX_RETRIES, DELETION_BASE_DELAY_MS } from "./AccountDeletionService.types.js";
import type {
  DeletionResult,
  DeletionAuditData,
  UserExportData,
} from "./AccountDeletionService.types.js";

// ─── Lazy Clerk singleton ─────────────────────────────────
type ClerkClient = ReturnType<typeof createClerkClient>;
let clerkInstance: ClerkClient | undefined;

function getClerk(): ClerkClient {
  if (!clerkInstance) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error("[ACCOUNT_DELETION] CLERK_SECRET_KEY is missing");
    }
    clerkInstance = createClerkClient({ secretKey });
  }
  return clerkInstance;
}

/** @internal Test seam — override the Clerk singleton for unit tests */
export function _setClerkForTest(client: ClerkClient | undefined): void {
  clerkInstance = client;
}

// ─── Constants ───────────────────────────────────────────
const BETA_ACTIVE_COUNT_KEY = "beta:active_count";
const ADMIN_METRICS_PATTERN = "admin:beta:metrics:*";
const REDIS_SCAN_BATCH_SIZE = 100;
const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;
const EXPORT_MAX_ITEMS = 5_000;

/** Redact email for logs — shows first 3 chars only */
function redactEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 3) return `***${email.slice(atIndex)}`;
  return `${email.slice(0, 3)}***${email.slice(atIndex)}`;
}

export class AccountDeletionService {
  /**
   * Permanently deletes a user and all their owned data.
   * Order: DB transaction first (atomic, rollbackable), then Clerk (irreversible).
   * Reassigns shared content to workspace owners.
   */
  static async deleteUserCompletely(userId: string): Promise<DeletionResult> {
    // 1. Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        betaStatus: true,
        createdAt: true,
        subscription: {
          select: { plan: true },
        },
      },
    });

    if (!user) {
      throw new Error(`[ACCOUNT_DELETION] User not found: ${userId}`);
    }

    // 2. Build audit data BEFORE deletion
    const deletedAt = new Date();
    const audit: DeletionAuditData = {
      email: user.email,
      betaStatus: user.betaStatus,
      createdAt: user.createdAt,
      plan: user.subscription?.plan ?? null,
      deletedAt,
    };

    logger.log(
      `[ACCOUNT_DELETION] Starting deletion for user ${userId} (email: ${redactEmail(user.email)}, beta: ${user.betaStatus}, plan: ${audit.plan ?? "none"})`,
    );

    // 3. Prisma transaction first (atomic, rollbackable on failure)
    await AccountDeletionService.executeDeletionTransaction(userId);

    // 4. Delete Clerk user (irreversible — only after DB succeeds)
    await AccountDeletionService.deleteClerkUser(userId);

    // 5. Invalidate Redis caches
    await AccountDeletionService.invalidateCaches();

    // 6. Log result
    logger.log(
      `[ACCOUNT_DELETION] Successfully deleted user ${userId} (email: ${redactEmail(audit.email)})`,
    );

    return { success: true, deletedUserId: userId, audit };
  }

  /**
   * Exports all user data for GDPR compliance (right to data portability).
   */
  static async exportUserData(userId: string): Promise<UserExportData> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new Error(`[ACCOUNT_DELETION] User not found for export: ${userId}`);
    }

    const [profile, workspaces, pages, quizzes, conversations, activityLogs, subscription] =
      await Promise.all([
        AccountDeletionService.fetchProfile(userId),
        AccountDeletionService.fetchWorkspaces(userId),
        AccountDeletionService.fetchPages(userId),
        AccountDeletionService.fetchQuizzes(userId),
        AccountDeletionService.fetchConversations(userId),
        AccountDeletionService.fetchActivityLogs(userId),
        AccountDeletionService.fetchSubscription(userId),
      ]);

    const truncated =
      pages.length >= EXPORT_MAX_ITEMS ||
      activityLogs.length >= EXPORT_MAX_ITEMS ||
      conversations.length >= EXPORT_MAX_ITEMS;

    return {
      profile,
      workspaces,
      pages,
      quizzes,
      conversations,
      activityLogs,
      subscription,
      truncated,
    };
  }

  // ─── Private: Clerk deletion ────────────────────────────

  private static async deleteClerkUser(userId: string): Promise<void> {
    try {
      const clerk = getClerk();
      await clerk.users.deleteUser(userId);
      logger.log(`[ACCOUNT_DELETION] Clerk user deleted: ${userId}`);
    } catch (error: unknown) {
      const status = isClerkApiError(error) ? error.status : undefined;
      if (status === 404) {
        logger.warn(`[ACCOUNT_DELETION] Clerk user already gone (404): ${userId}`);
        return;
      }
      throw error;
    }
  }

  // ─── Private: Prisma transaction with retry ─────────────

  private static async executeDeletionTransaction(userId: string): Promise<void> {
    for (let attempt = 1; attempt <= DELETION_MAX_RETRIES; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            // a) Delete activity logs (no cascade from User)
            await tx.activityLog.deleteMany({ where: { userId } });

            // b) Reassign shared pages and projects to workspace owners
            await AccountDeletionService.reassignSharedEntities(tx, userId, "page");
            await AccountDeletionService.reassignSharedEntities(tx, userId, "project");

            // c) Nullify invitedBy references (no cascade from User)
            await tx.workspaceMember.updateMany({
              where: { invitedBy: userId },
              data: { invitedBy: null },
            });

            // d) Delete user — cascade handles owned workspaces, quizzes, etc.
            await tx.user.delete({ where: { id: userId } });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: TRANSACTION_TIMEOUT_MS,
            maxWait: TRANSACTION_MAX_WAIT_MS,
          },
        );
        return;
      } catch (error: unknown) {
        const isSerializationError =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

        if (!isSerializationError || attempt === DELETION_MAX_RETRIES) {
          logger.error(`[ACCOUNT_DELETION] Transaction failed after ${attempt} attempt(s):`, error);
          throw error;
        }

        const delayMs = DELETION_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[ACCOUNT_DELETION] Serialization conflict (attempt ${attempt}/${DELETION_MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Generic helper: finds entities created by userId in workspaces NOT owned by userId,
   * and reassigns createdBy to the workspace owner. Works for both pages and projects.
   */
  private static async reassignSharedEntities(
    tx: Prisma.TransactionClient,
    userId: string,
    entityType: "page" | "project",
  ): Promise<void> {
    const model = tx[entityType];
    const sharedEntities = await (model as Prisma.TransactionClient["page"]).findMany({
      where: {
        createdBy: userId,
        workspace: { ownerId: { not: userId } },
      },
      select: {
        id: true,
        workspace: { select: { ownerId: true } },
      },
    });

    for (const entity of sharedEntities) {
      await (model as Prisma.TransactionClient["page"]).update({
        where: { id: entity.id },
        data: { createdBy: entity.workspace.ownerId },
      });
    }

    if (sharedEntities.length > 0) {
      logger.log(
        `[ACCOUNT_DELETION] Reassigned ${sharedEntities.length} shared ${entityType}s for user ${userId}`,
      );
    }
  }

  // ─── Private: Redis invalidation ────────────────────────

  private static async invalidateCaches(): Promise<void> {
    try {
      await redis.del(BETA_ACTIVE_COUNT_KEY);

      const metricsKeys = await scanRedisKeys(ADMIN_METRICS_PATTERN);
      if (metricsKeys.length > 0) {
        await redis.del(...metricsKeys);
      }
    } catch (error: unknown) {
      logger.warn("[ACCOUNT_DELETION] Redis cache invalidation failed:", error);
    }
  }

  // ─── Private: Export helpers ─────────────────────────────

  private static async fetchProfile(userId: string): Promise<UserExportData["profile"]> {
    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
        betaStatus: true,
        betaJoinedAt: true,
        onboardingCompleted: true,
        settings: true,
      },
    });
  }

  private static async fetchWorkspaces(userId: string): Promise<UserExportData["workspaces"]> {
    return prisma.workspace.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        createdAt: true,
        isArchived: true,
        members: {
          select: {
            userId: true,
            role: true,
            joinedAt: true,
          },
        },
      },
    });
  }

  private static async fetchPages(userId: string): Promise<UserExportData["pages"]> {
    return prisma.page.findMany({
      where: { createdBy: userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
        projectId: true,
        blockNoteContent: true,
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchQuizzes(userId: string): Promise<UserExportData["quizzes"]> {
    return prisma.quiz.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        isCompleted: true,
        completedAt: true,
        questions: true,
        userAnswers: true,
      },
    });
  }

  private static async fetchConversations(
    userId: string,
  ): Promise<UserExportData["conversations"]> {
    return prisma.aIConversation.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        messageCount: true,
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchActivityLogs(userId: string): Promise<UserExportData["activityLogs"]> {
    return prisma.activityLog.findMany({
      where: { userId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        details: true,
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchSubscription(userId: string): Promise<UserExportData["subscription"]> {
    return prisma.userSubscription.findUnique({
      where: { userId },
      select: {
        plan: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });
  }
}

// ─── Utilities ──────────────────────────────────────────────

/** Type guard for Clerk API errors with a status property */
function isClerkApiError(error: unknown): error is { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

/** SCAN-based key lookup (avoids KEYS in production) */
async function scanRedisKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      REDIS_SCAN_BATCH_SIZE,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}
