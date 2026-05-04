import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { createClerkClient } from "@clerk/backend";
import { Prisma } from "@prisma/client";

import { DELETION_MAX_RETRIES, DELETION_BASE_DELAY_MS } from "./AccountDeletionService.types.js";
import type { DeletionResult, DeletionAuditData } from "./AccountDeletionService.types.js";
import { runExternalCascade } from "./accountDeletionExternals.js";
import { isClerkApiError, scanRedisKeys, redactEmail } from "./accountDeletionUtils.js";

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
  if (process.env.NODE_ENV !== "test") {
    throw new Error("[ACCOUNT_DELETION] _setClerkForTest is only available in test environment");
  }
  clerkInstance = client;
}

// ─── Constants ───────────────────────────────────────────
const BETA_ACTIVE_COUNT_KEY = "beta:active_count";
const ADMIN_METRICS_PATTERN = "admin:beta:metrics:*";
const TRANSACTION_TIMEOUT_MS = 30_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

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

    // 2. Build audit data BEFORE deletion — never store raw PII
    const deletedAt = new Date();
    const masked = redactEmail(user.email);
    const audit: DeletionAuditData = {
      maskedEmail: masked,
      betaStatus: user.betaStatus,
      createdAt: user.createdAt,
      plan: user.subscription?.plan ?? null,
      deletedAt,
    };

    logger.log(
      `[ACCOUNT_DELETION] Starting deletion for user ${userId} (email: ${masked}, beta: ${user.betaStatus}, plan: ${audit.plan ?? "none"})`,
    );

    // 3. External cascade (Cloudinary, embeddings, Paddle, Mem0) — best-effort.
    //    Run BEFORE the Prisma transaction so we still have paddleCustomerId,
    //    and a partial failure cannot leave us with the user wiped locally
    //    while still owning external resources we can no longer trace.
    const cascade = await runExternalCascade(userId);

    // 4. Prisma transaction (atomic, rollbackable on failure)
    await AccountDeletionService.executeDeletionTransaction(userId);

    // 5. Delete Clerk user (irreversible — only after DB succeeds)
    await AccountDeletionService.deleteClerkUser(userId);

    // 6. Invalidate Redis caches
    await AccountDeletionService.invalidateCaches();

    // 7. Final structured log — single grep target for ops to spot
    //    external systems that need a manual sweep.
    logger.log(
      `[AccountDeletion] cascade_complete userId=${userId} cloudinary=${cascade.cloudinary} embeddings=${cascade.embeddings} paddle=${cascade.paddle} mem0=${cascade.mem0}`,
    );
    logger.log(
      `[ACCOUNT_DELETION] Successfully deleted user ${userId} (email: ${audit.maskedEmail})`,
    );

    return { success: true, deletedUserId: userId, audit };
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
          (tx) => AccountDeletionService.buildDeletionOperations(tx, userId),
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

  /** All deletion operations inside a single Serializable transaction */
  private static async buildDeletionOperations(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    // a) Delete activity logs (no cascade from User)
    await tx.activityLog.deleteMany({ where: { userId } });

    // b) Transfer owned workspaces that have other members
    await AccountDeletionService.transferOwnedWorkspaces(tx, userId);

    // c) Reassign shared pages and projects to workspace owners
    await AccountDeletionService.reassignSharedEntities(tx, userId, "page");
    await AccountDeletionService.reassignSharedEntities(tx, userId, "project");

    // d) Nullify invitedBy references (no cascade from User)
    await tx.workspaceMember.updateMany({
      where: { invitedBy: userId },
      data: { invitedBy: null },
    });

    // e) Delete user — cascade handles solo workspaces, quizzes, etc.
    await tx.user.delete({ where: { id: userId } });
  }

  /**
   * Transfers ownership of the user's workspaces to the next eligible member.
   * Without this, cascade-delete would destroy ALL content (pages, projects, conversations)
   * belonging to OTHER members in the deleted user's workspaces.
   * Solo workspaces (no other members) are left for cascade-delete.
   */
  private static async transferOwnedWorkspaces(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const ownedWorkspaces = await tx.workspace.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        members: {
          where: { userId: { not: userId }, isActive: true },
          select: { userId: true, role: true },
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    for (const ws of ownedWorkspaces) {
      if (ws.members.length === 0) continue; // solo workspace — cascade is fine

      // Prefer admin member, fallback to oldest active member
      const newOwner = ws.members.find((m) => m.role === "admin") ?? ws.members[0];

      await tx.workspace.update({
        where: { id: ws.id },
        data: { ownerId: newOwner.userId },
      });

      // Remove the departing user's membership
      await tx.workspaceMember.deleteMany({
        where: { workspaceId: ws.id, userId },
      });

      logger.log(
        `[ACCOUNT_DELETION] Transferred workspace ${ws.id} from ${userId} to ${newOwner.userId}`,
      );
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
}

// Utilities moved to ./accountDeletionUtils.ts
