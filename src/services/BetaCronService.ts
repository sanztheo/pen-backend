import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { Prisma } from "@prisma/client";

import {
  TOTAL_BETA_SPOTS,
  STATUS_CACHE_KEY,
  SERIALIZATION_MAX_RETRIES,
  SERIALIZATION_BASE_DELAY_MS,
  REACTIVATION_WINDOW_DAYS,
} from "./BetaService.types.js";

// ─── Cron-specific configuration ─────────────────────────────────
const INACTIVITY_THRESHOLD_DAYS = 7;
const DELETION_BATCH_SIZE = 50;
const CRON_LOCK_TTL_SECONDS = 300; // 5 minutes
const EMAIL_BATCH_SIZE = 5;
const EMAIL_BATCH_DELAY_MS = 1_000;
const POSITION_UPDATE_STEP = 10; // Notify every 10 positions gained
const WAITLIST_PAGE_SIZE = 500;

// ─── Result types ──────────────────────────────────────────────
interface CronJobResult {
  processed: number;
  errors: number;
}

export class BetaCronService {
  /**
   * Deactivates users who haven't sent a heartbeat in INACTIVITY_THRESHOLD_DAYS.
   * Sets betaReactivationDeadline to give them REACTIVATION_WINDOW_DAYS to come back.
   * Runs hourly.
   */
  static async checkInactiveUsers(): Promise<CronJobResult> {
    const thresholdDate = new Date(Date.now() - INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();
    const reactivationDeadline = new Date(
      now.getTime() + REACTIVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const inactiveUsers = await prisma.user.findMany({
      where: {
        betaStatus: "active",
        OR: [
          { lastHeartbeatAt: { lt: thresholdDate } },
          // Only flag null-heartbeat users if they joined before the threshold
          // (freshly activated/promoted users must NOT be deactivated immediately)
          {
            lastHeartbeatAt: null,
            betaJoinedAt: { lt: thresholdDate },
          },
        ],
      },
      select: { id: true, lastHeartbeatAt: true },
    });

    if (inactiveUsers.length === 0) {
      logger.log("[BETA_CRON] checkInactiveUsers: no inactive users found");
      return { processed: 0, errors: 0 };
    }

    const userIds = inactiveUsers.map((u) => u.id);

    const result = await prisma.user.updateMany({
      where: {
        id: { in: userIds },
        betaStatus: "active",
        OR: [
          { lastHeartbeatAt: { lt: thresholdDate } },
          {
            lastHeartbeatAt: null,
            betaJoinedAt: { lt: thresholdDate },
          },
        ],
      },
      data: {
        betaStatus: "inactive",
        betaDeactivatedAt: now,
        betaReactivationDeadline: reactivationDeadline,
      },
    });

    await redis.del(STATUS_CACHE_KEY).catch((err: unknown) => {
      logger.warn("[BETA_CRON] Redis cache invalidation failed after deactivation:", err);
    });

    for (const user of inactiveUsers) {
      logger.log(
        `[BETA_CRON] Deactivated user ${user.id} (last heartbeat: ${user.lastHeartbeatAt?.toISOString() ?? "never"})`,
      );
    }

    logger.log(`[BETA_CRON] checkInactiveUsers: ${result.count} users deactivated`);

    return { processed: result.count, errors: 0 };
  }

  /**
   * Resets weeklyActiveTimeSeconds and weeklySessionCount for all active users.
   * Runs Monday 00:00 UTC. Uses batch UPDATE (no row-by-row loop).
   */
  static async resetWeeklyCounters(): Promise<CronJobResult> {
    const result = await prisma.user.updateMany({
      where: { betaStatus: "active" },
      data: {
        weeklyActiveTimeSeconds: 0,
        weeklySessionCount: 0,
      },
    });

    logger.log(`[BETA_CRON] resetWeeklyCounters: ${result.count} users reset`);

    return { processed: result.count, errors: 0 };
  }

  /**
   * Promotes waitlisted users when beta spots are available.
   * Uses Serializable transaction with P2034 retry (same pattern as reactivateUser).
   * Runs hourly.
   */
  static async processWaitlist(): Promise<CronJobResult> {
    let promoted = 0;
    let errors = 0;

    const activeCount = await prisma.user.count({
      where: { betaStatus: "active" },
    });

    const availableSpots = Math.max(0, TOTAL_BETA_SPOTS - activeCount);

    if (availableSpots === 0) {
      logger.log("[BETA_CRON] processWaitlist: no spots available");
      return { processed: 0, errors: 0 };
    }

    const waitlistEntries = await prisma.betaWaitlist.findMany({
      where: { userId: { not: null } },
      orderBy: { joinedAt: "asc" },
      take: availableSpots,
      select: { id: true, userId: true, email: true, name: true },
    });

    if (waitlistEntries.length === 0) {
      logger.log("[BETA_CRON] processWaitlist: no eligible waitlist entries");
      return { processed: 0, errors: 0 };
    }

    const promotedUsers: { email: string; name: string }[] = [];

    for (const entry of waitlistEntries) {
      if (!entry.userId) continue;

      try {
        await BetaCronService.executeWaitlistPromotion(entry.userId, entry.id);
        promoted++;
        promotedUsers.push({ email: entry.email, name: entry.name });

        logger.log(`[BETA_CRON] Promoted user ${entry.userId} from waitlist`);
      } catch (error: unknown) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);

        if (message === "NO_SPOTS_AVAILABLE") {
          logger.warn("[BETA_CRON] processWaitlist: spots filled during promotion, stopping");
          break;
        }

        logger.error(`[BETA_CRON] Failed to promote user ${entry.userId}: ${message}`);
      }
    }

    // Send spot-available emails in batches of 5 with 1s delay between batches
    // to respect Resend rate limits and avoid unbounded concurrency
    if (promotedUsers.length > 0) {
      BetaCronService.sendPromotionEmailsBatched(promotedUsers).catch((emailErr: unknown) => {
        logger.warn("[BETA_CRON] Batch email notification failed:", emailErr);
      });
    }

    if (promoted > 0) {
      await redis.del(STATUS_CACHE_KEY).catch((err: unknown) => {
        logger.warn("[BETA_CRON] Redis cache invalidation failed after promotion:", err);
      });
    }

    logger.log(`[BETA_CRON] processWaitlist: ${promoted} promoted, ${errors} errors`);

    return { processed: promoted, errors };
  }

  /**
   * Cleans up accounts whose reactivation deadline has passed.
   * Transitions inactive -> expired and removes from waitlist.
   * Runs hourly.
   */
  static async cleanupExpiredAccounts(): Promise<CronJobResult> {
    const lockKey = "cron:lock:cleanupExpiredAccounts";
    const acquired = await redis.set(lockKey, "1", "EX", CRON_LOCK_TTL_SECONDS, "NX");

    if (!acquired) {
      logger.log("[BETA_CRON] cleanupExpiredAccounts: skipped (another instance holds the lock)");
      return { processed: 0, errors: 0 };
    }

    try {
      return await BetaCronService._cleanupExpiredAccountsLocked();
    } finally {
      await redis.del(lockKey).catch((err: unknown) => {
        logger.warn("[BETA_CRON] Failed to release cleanup lock:", err);
      });
    }
  }

  private static async _cleanupExpiredAccountsLocked(): Promise<CronJobResult> {
    const now = new Date();

    const expiredUsers = await prisma.user.findMany({
      where: {
        betaStatus: "inactive",
        betaReactivationDeadline: { lt: now },
      },
      select: { id: true, betaReactivationDeadline: true },
      take: DELETION_BATCH_SIZE,
    });

    if (expiredUsers.length === 0) {
      logger.log("[BETA_CRON] cleanupExpiredAccounts: no expired accounts");
      return { processed: 0, errors: 0 };
    }

    const userIds = expiredUsers.map((u) => u.id);

    const [updateResult] = await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: { in: userIds }, betaStatus: "inactive" },
        data: { betaStatus: "expired" },
      }),
      prisma.betaWaitlist.deleteMany({
        where: { userId: { in: userIds } },
      }),
    ]);

    await redis.del(STATUS_CACHE_KEY).catch((err: unknown) => {
      logger.warn("[BETA_CRON] Redis cache invalidation failed after expiration cleanup:", err);
    });

    for (const user of expiredUsers) {
      logger.log(
        `[BETA_CRON] Expired user ${user.id} (deadline was: ${user.betaReactivationDeadline?.toISOString()})`,
      );
    }

    logger.log(`[BETA_CRON] cleanupExpiredAccounts: ${updateResult.count} accounts expired`);

    // ─── Optional: permanently delete expired accounts ────
    if (process.env.ENABLE_ACCOUNT_DELETION === "true") {
      const { deletedCount, deleteErrors } = await BetaCronService.deleteExpiredUsers(expiredUsers);
      logger.log(`[BETA_CRON] Account deletion: ${deletedCount} deleted, ${deleteErrors} errors`);
      return { processed: updateResult.count + deletedCount, errors: deleteErrors };
    }

    return { processed: updateResult.count, errors: 0 };
  }

  /**
   * Permanently deletes expired user accounts via AccountDeletionService.
   * Uses dynamic import to avoid circular dependency at module load.
   */
  private static async deleteExpiredUsers(
    users: Array<{ id: string }>,
  ): Promise<{ deletedCount: number; deleteErrors: number }> {
    const { AccountDeletionService } = await import("./AccountDeletionService.js");

    let deletedCount = 0;
    let deleteErrors = 0;

    for (const user of users) {
      try {
        await AccountDeletionService.deleteUserCompletely(user.id);
        deletedCount++;
        logger.log(`[BETA_CRON] Permanently deleted expired user ${user.id}`);
      } catch (error: unknown) {
        deleteErrors++;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[BETA_CRON] Failed to delete expired user ${user.id}: ${message}`);
      }
    }

    return { deletedCount, deleteErrors };
  }

  /**
   * Executes a single waitlist promotion inside a Serializable transaction.
   * Retries on P2034 (serialization conflict) with exponential backoff.
   */
  private static async executeWaitlistPromotion(
    userId: string,
    waitlistEntryId: string,
  ): Promise<void> {
    for (let attempt = 1; attempt <= SERIALIZATION_MAX_RETRIES; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const activeCount = await tx.user.count({
              where: { betaStatus: "active" },
            });

            if (activeCount >= TOTAL_BETA_SPOTS) {
              throw new Error("NO_SPOTS_AVAILABLE");
            }

            const now = new Date();

            await tx.user.update({
              where: { id: userId },
              data: {
                betaStatus: "active",
                betaJoinedAt: now,
                betaDeactivatedAt: null,
                betaReactivationDeadline: null,
                weeklyActiveTimeSeconds: 0,
                weeklySessionCount: 0,
                lastActiveAt: now,
              },
            });

            await tx.betaWaitlist.delete({
              where: { id: waitlistEntryId },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "NO_SPOTS_AVAILABLE") {
          throw error;
        }

        const isSerializationError =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

        if (!isSerializationError || attempt === SERIALIZATION_MAX_RETRIES) {
          logger.error(
            `[BETA_CRON] Waitlist promotion transaction failed after ${attempt} attempt(s):`,
            error,
          );
          throw error;
        }

        const delayMs = SERIALIZATION_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[BETA_CRON] Serialization conflict on promotion (attempt ${attempt}/${SERIALIZATION_MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Sends position update emails to waitlisted users who moved 10+ positions
   * since their last notification. Uses metadata.lastNotifiedPosition to track.
   * Runs hourly (after processWaitlist).
   */
  static async sendPositionUpdates(): Promise<CronJobResult> {
    const lockKey = "cron:lock:sendPositionUpdates";
    const acquired = await redis.set(lockKey, "1", "EX", CRON_LOCK_TTL_SECONDS, "NX");

    if (!acquired) {
      logger.log("[BETA_CRON] sendPositionUpdates: skipped (another instance holds the lock)");
      return { processed: 0, errors: 0 };
    }

    try {
      return await BetaCronService._sendPositionUpdatesLocked();
    } finally {
      await redis.del(lockKey).catch((err: unknown) => {
        logger.warn("[BETA_CRON] Failed to release sendPositionUpdates lock:", err);
      });
    }
  }

  private static async _sendPositionUpdatesLocked(): Promise<CronJobResult> {
    const toNotify: Array<{
      id: string;
      email: string;
      name: string;
      position: number;
      existingMeta: Record<string, unknown>;
    }> = [];

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const entries = await prisma.betaWaitlist.findMany({
        orderBy: { joinedAt: "asc" },
        select: { id: true, email: true, name: true, metadata: true },
        take: WAITLIST_PAGE_SIZE,
        skip: offset,
      });

      if (entries.length === 0 && offset === 0) {
        logger.log("[BETA_CRON] sendPositionUpdates: empty waitlist");
        return { processed: 0, errors: 0 };
      }

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const currentPosition = offset + i + 1;
        const meta = (entry.metadata as Record<string, unknown> | null) ?? {};
        const lastNotified =
          typeof meta.lastNotifiedPosition === "number" ? meta.lastNotifiedPosition : undefined;

        // First time: seed the position without sending an email (they already got confirmation)
        if (lastNotified === undefined) {
          await prisma.betaWaitlist.update({
            where: { id: entry.id },
            data: {
              metadata: { ...meta, lastNotifiedPosition: currentPosition },
            },
          });
          continue;
        }

        // Only notify if they moved forward by at least POSITION_UPDATE_STEP
        if (lastNotified - currentPosition >= POSITION_UPDATE_STEP) {
          toNotify.push({
            id: entry.id,
            email: entry.email,
            name: entry.name,
            position: currentPosition,
            existingMeta: meta,
          });
        }
      }

      offset += entries.length;
      hasMore = entries.length === WAITLIST_PAGE_SIZE;
    }

    if (toNotify.length === 0) {
      logger.log("[BETA_CRON] sendPositionUpdates: no users crossed a milestone");
      return { processed: 0, errors: 0 };
    }

    const { EmailService } = await import("./EmailService.js");
    let sent = 0;
    let errors = 0;

    for (let i = 0; i < toNotify.length; i += EMAIL_BATCH_SIZE) {
      const chunk = toNotify.slice(i, i + EMAIL_BATCH_SIZE);

      const results = await Promise.allSettled(
        chunk.map(async (user) => {
          await EmailService.sendWaitlistPositionUpdate({
            to: user.email,
            name: user.name,
            newPosition: user.position,
          });
          await prisma.betaWaitlist.update({
            where: { id: user.id },
            data: {
              notifiedAt: new Date(),
              metadata: { ...user.existingMeta, lastNotifiedPosition: user.position },
            },
          });
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") sent++;
        else {
          errors++;
          logger.warn("[BETA_CRON] Position update email failed:", r.reason);
        }
      }

      const hasMore = i + EMAIL_BATCH_SIZE < toNotify.length;
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
      }
    }

    logger.log(`[BETA_CRON] sendPositionUpdates: ${sent} notified, ${errors} errors`);
    return { processed: sent, errors };
  }

  /**
   * Sends promotion emails in chunks to respect Resend rate limits.
   * Processes EMAIL_BATCH_SIZE emails concurrently, then waits EMAIL_BATCH_DELAY_MS.
   */
  private static async sendPromotionEmailsBatched(
    users: Array<{ email: string; name: string }>,
  ): Promise<void> {
    const { EmailService } = await import("./EmailService.js");

    for (let i = 0; i < users.length; i += EMAIL_BATCH_SIZE) {
      const chunk = users.slice(i, i + EMAIL_BATCH_SIZE);

      await Promise.all(
        chunk.map((user) => EmailService.sendSpotAvailable({ to: user.email, name: user.name })),
      );

      // Delay between batches (skip after last batch)
      const hasMoreBatches = i + EMAIL_BATCH_SIZE < users.length;
      if (hasMoreBatches) {
        await new Promise((resolve) => setTimeout(resolve, EMAIL_BATCH_DELAY_MS));
      }
    }
  }
}
