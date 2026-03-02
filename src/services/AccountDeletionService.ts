import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { maskEmail } from "../utils/maskEmail.js";
import { Prisma } from "@prisma/client";
import {
  DELETION_LOG_PREFIX,
  DELETION_LOCK_KEY,
  DELETION_LOCK_TTL_SECONDS,
  type DeletionAuditEntry,
} from "./AccountDeletionService.types.js";
import {
  SERIALIZATION_MAX_RETRIES,
  SERIALIZATION_BASE_DELAY_MS,
  STATUS_CACHE_KEY,
} from "./BetaService.types.js";

// ─── Clerk client (lazy-loaded for test mocking) ────────
type ClerkDeleteFn = (userId: string) => Promise<unknown>;

let clerkDeleteUser: ClerkDeleteFn | null = null;

async function getClerkDeleteUser(): Promise<ClerkDeleteFn> {
  if (clerkDeleteUser) return clerkDeleteUser;

  const { createClerkClient } = await import("@clerk/backend");
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(`${DELETION_LOG_PREFIX} CLERK_SECRET_KEY is not set`);
  }

  const client = createClerkClient({ secretKey });
  clerkDeleteUser = (userId: string) => client.users.deleteUser(userId);
  return clerkDeleteUser;
}

/** @internal — for unit tests only */
export function _setClerkForTest(fn: ClerkDeleteFn | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("_setClerkForTest is only available in test environment");
  }
  clerkDeleteUser = fn;
}

// ─── Service ─────────────────────────────────────────────

export class AccountDeletionService {
  /**
   * Permanently deletes a user and all associated data.
   * Transaction order: DB first, Clerk last (DB can rollback if Clerk fails).
   * Uses Serializable isolation with P2034 retry.
   */
  static async deleteUserCompletely(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new Error(`${DELETION_LOG_PREFIX} User not found: ${userId}`);
    }

    // Audit entry with masked PII for GDPR compliance
    const auditEntry: DeletionAuditEntry = {
      userId: user.id,
      maskedEmail: maskEmail(user.email),
      deletedAt: new Date().toISOString(),
      reason: "user_request",
    };
    logger.log(`${DELETION_LOG_PREFIX} Audit: ${JSON.stringify(auditEntry)}`);

    // Execute deletion in Serializable transaction with P2034 retry
    await AccountDeletionService.executeDeletionTransaction(userId);

    // Delete from Clerk (after DB commit — cannot rollback Clerk)
    try {
      const deleteFn = await getClerkDeleteUser();
      await deleteFn(userId);
      logger.log(`${DELETION_LOG_PREFIX} Clerk user deleted: ${userId}`);
    } catch (error: unknown) {
      // DB deletion succeeded; Clerk failure is logged but not thrown
      // (orphan Clerk account is recoverable, orphan DB rows are not)
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`${DELETION_LOG_PREFIX} Clerk deletion failed for ${userId}: ${message}`);
    }

    // Invalidate beta status cache
    await redis.del(STATUS_CACHE_KEY).catch((err: unknown) => {
      logger.warn(`${DELETION_LOG_PREFIX} Redis cache invalidation failed:`, err);
    });

    logger.log(`${DELETION_LOG_PREFIX} User fully deleted: ${userId}`);
  }

  /**
   * Deletes expired user accounts (cron integration).
   * Uses distributed Redis lock (SETNX + TTL) to prevent double execution.
   */
  static async deleteExpiredUsers(): Promise<{
    deleted: number;
    errors: number;
  }> {
    const lockAcquired = await redis
      .set(DELETION_LOCK_KEY, "1", "EX", DELETION_LOCK_TTL_SECONDS, "NX")
      .catch(() => null);

    if (!lockAcquired) {
      logger.log(`${DELETION_LOG_PREFIX} Lock not acquired, skipping expired user cleanup`);
      return { deleted: 0, errors: 0 };
    }

    let deleted = 0;
    let errors = 0;

    try {
      const expiredUsers = await prisma.user.findMany({
        where: { betaStatus: "expired" },
        select: { id: true },
      });

      for (const user of expiredUsers) {
        try {
          await AccountDeletionService.deleteUserCompletely(user.id);
          deleted++;
        } catch (error: unknown) {
          errors++;
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            `${DELETION_LOG_PREFIX} Failed to delete expired user ${user.id}: ${message}`,
          );
        }
      }

      logger.log(`${DELETION_LOG_PREFIX} Expired cleanup: ${deleted} deleted, ${errors} errors`);
    } finally {
      await redis.del(DELETION_LOCK_KEY).catch(() => {});
    }

    return { deleted, errors };
  }

  // ─── Private ─────────────────────────────────────────────

  /**
   * Serializable transaction with P2034 retry.
   * Order: transfer shared workspaces → reassign content → nullify refs → delete user.
   */
  private static async executeDeletionTransaction(userId: string): Promise<void> {
    for (let attempt = 1; attempt <= SERIALIZATION_MAX_RETRIES; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            // 1. Find workspaces owned by user
            const ownedWorkspaces = await tx.workspace.findMany({
              where: { ownerId: userId },
              select: { id: true },
            });
            const ownedWorkspaceIds = ownedWorkspaces.map((w) => w.id);

            // 2. Transfer shared workspaces to next member (prevents cascade-deleting others' content)
            await AccountDeletionService.transferOwnedWorkspaces(tx, userId, ownedWorkspaceIds);

            // 3. Reassign user's pages in workspaces they don't own to workspace owner
            await AccountDeletionService.reassignContent(tx, userId, ownedWorkspaceIds);

            // 4. Nullify invitedBy references
            await tx.workspaceMember.updateMany({
              where: { invitedBy: userId },
              data: { invitedBy: null },
            });

            // 5. Delete activity logs (no cascade on user FK)
            await tx.activityLog.deleteMany({
              where: { userId },
            });

            // 6. Delete beta waitlist entries
            await tx.betaWaitlist.deleteMany({
              where: { userId },
            });

            // 7. Delete user (cascades: solo workspaces, subscriptions, quizzes, etc.)
            await tx.user.delete({
              where: { id: userId },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error: unknown) {
        const isSerializationError =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

        if (!isSerializationError || attempt === SERIALIZATION_MAX_RETRIES) {
          logger.error(
            `${DELETION_LOG_PREFIX} Deletion transaction failed after ${attempt} attempt(s):`,
            error,
          );
          throw error;
        }

        const delayMs = SERIALIZATION_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `${DELETION_LOG_PREFIX} Serialization conflict (attempt ${attempt}/${SERIALIZATION_MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Transfers ownership of shared workspaces to the next active member.
   * Solo workspaces (no other members) are left to cascade-delete with the user.
   */
  private static async transferOwnedWorkspaces(
    tx: Prisma.TransactionClient,
    userId: string,
    ownedWorkspaceIds: string[],
  ): Promise<void> {
    for (const wsId of ownedWorkspaceIds) {
      const nextMember = await tx.workspaceMember.findFirst({
        where: { workspaceId: wsId, userId: { not: userId }, isActive: true },
        orderBy: { joinedAt: "asc" },
        select: { userId: true },
      });

      if (!nextMember) continue;

      // Transfer workspace ownership
      await tx.workspace.update({
        where: { id: wsId },
        data: { ownerId: nextMember.userId },
      });

      // Reassign deleted user's content in this workspace to new owner
      await tx.page.updateMany({
        where: { workspaceId: wsId, createdBy: userId },
        data: { createdBy: nextMember.userId },
      });
      await tx.project.updateMany({
        where: { workspaceId: wsId, createdBy: userId },
        data: { createdBy: nextMember.userId },
      });
    }
  }

  /**
   * Reassigns user's pages and projects in workspaces they don't own
   * to the respective workspace owner. Groups by workspace for batch updates.
   */
  private static async reassignContent(
    tx: Prisma.TransactionClient,
    userId: string,
    ownedWorkspaceIds: string[],
  ): Promise<void> {
    const models = [tx.page, tx.project] as const;

    for (const model of models) {
      const items = await (model as { findMany: typeof tx.page.findMany }).findMany({
        where: { createdBy: userId, workspaceId: { notIn: ownedWorkspaceIds } },
        select: { id: true, workspaceId: true },
      });

      if (items.length === 0) continue;

      const byWorkspace = new Map<string, string[]>();
      for (const item of items) {
        const ids = byWorkspace.get(item.workspaceId) ?? [];
        ids.push(item.id);
        byWorkspace.set(item.workspaceId, ids);
      }

      for (const [workspaceId, itemIds] of byWorkspace) {
        const ws = await tx.workspace.findUnique({
          where: { id: workspaceId },
          select: { ownerId: true },
        });
        if (ws) {
          await (model as { updateMany: typeof tx.page.updateMany }).updateMany({
            where: { id: { in: itemIds } },
            data: { createdBy: ws.ownerId },
          });
        }
      }
    }
  }
}
