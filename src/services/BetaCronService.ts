import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { Prisma } from "@prisma/client";

import {
  TOTAL_BETA_SPOTS,
  STATUS_CACHE_KEY,
  SERIALIZATION_MAX_RETRIES,
  SERIALIZATION_BASE_DELAY_MS,
} from "./BetaService.types.js";

// ─── Cron-specific configuration ─────────────────────────────────
const INACTIVITY_THRESHOLD_DAYS = 7;
const REACTIVATION_WINDOW_DAYS = 14;

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

    // Fire-and-forget: send spot-available emails sequentially (respects Resend rate limits)
    if (promotedUsers.length > 0) {
      import("./EmailService.js")
        .then(async ({ EmailService }) => {
          for (const user of promotedUsers) {
            await EmailService.sendSpotAvailable({ to: user.email, name: user.name });
          }
        })
        .catch((emailErr: unknown) => {
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
    const now = new Date();

    const expiredUsers = await prisma.user.findMany({
      where: {
        betaStatus: "inactive",
        betaReactivationDeadline: { lt: now },
      },
      select: { id: true, email: true, betaReactivationDeadline: true },
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

    // Feature flag: delete expired users if enabled
    if (process.env.ENABLE_ACCOUNT_DELETION === "true") {
      import("./AccountDeletionService.js")
        .then(({ AccountDeletionService }) => AccountDeletionService.deleteExpiredUsers())
        .catch((err: unknown) => {
          logger.error("[BETA_CRON] Failed to run expired user deletion:", err);
        });
    }

    return { processed: updateResult.count, errors: 0 };
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
}
