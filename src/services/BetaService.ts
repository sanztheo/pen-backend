import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";
import { Prisma } from "@prisma/client";
import type { BetaStatus } from "@prisma/client";

const TOTAL_BETA_SPOTS = 100;
const HEARTBEAT_INCREMENT_SECONDS = 30;
const HEARTBEAT_MIN_INTERVAL_SECONDS = 25;
const STATUS_CACHE_KEY = "beta:active_count";
const STATUS_CACHE_TTL_SECONDS = 30;
const SERIALIZATION_MAX_RETRIES = 3;
const SERIALIZATION_BASE_DELAY_MS = 50;

interface BetaStatusResponse {
  spotsRemaining: number;
  totalSpots: number;
  isFull: boolean;
  userStatus: BetaStatus | undefined;
}

interface WaitlistInput {
  email: string;
  name: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}

interface WaitlistResult {
  position: number;
  alreadyExists: boolean;
  rejected?: boolean;
}

export class BetaService {
  /**
   * Returns current beta status: remaining spots + optional user status
   */
  static async getStatus(userId?: string): Promise<BetaStatusResponse> {
    // Cache active count in Redis (30s TTL) to avoid COUNT on every page view
    let activeCount: number;
    try {
      const cached = await redis.get(STATUS_CACHE_KEY);
      if (cached !== null) {
        activeCount = parseInt(cached, 10);
      } else {
        activeCount = await prisma.user.count({
          where: { betaStatus: "active" },
        });
        await redis.set(
          STATUS_CACHE_KEY,
          activeCount,
          "EX",
          STATUS_CACHE_TTL_SECONDS,
        );
      }
    } catch {
      // Redis down — fallback to DB
      activeCount = await prisma.user.count({
        where: { betaStatus: "active" },
      });
    }

    const spotsRemaining = Math.max(0, TOTAL_BETA_SPOTS - activeCount);

    let userStatus: BetaStatus | undefined;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { betaStatus: true },
      });
      userStatus = user?.betaStatus;
    }

    return {
      spotsRemaining,
      totalSpots: TOTAL_BETA_SPOTS,
      isFull: spotsRemaining === 0,
      userStatus,
    };
  }

  /**
   * Records a heartbeat ping — ultra-lightweight, single atomic UPDATE
   * Increments weekly + total active time by 30s
   */
  static async recordHeartbeat(userId: string): Promise<boolean> {
    // Atomic UPDATE: only increment if user is active AND last heartbeat was >= 25s ago
    // This prevents counter inflation from rapid concurrent requests
    // Single raw query = ultra-fast, no round-trips
    const result = await prisma.$executeRaw`
      UPDATE "user"
      SET
        "weekly_active_time_seconds" = "weekly_active_time_seconds" + ${HEARTBEAT_INCREMENT_SECONDS},
        "total_active_time_seconds" = "total_active_time_seconds" + ${HEARTBEAT_INCREMENT_SECONDS},
        "last_heartbeat_at" = NOW(),
        "last_active_at" = NOW()
      WHERE "id" = ${userId}
        AND "beta_status" = 'active'
        AND (
          "last_heartbeat_at" IS NULL
          OR "last_heartbeat_at" < NOW() - make_interval(secs => ${HEARTBEAT_MIN_INTERVAL_SECONDS})
        )
    `;

    return result > 0;
  }

  /**
   * Adds an entry to the beta waitlist
   * Returns position and whether the entry already existed
   */
  static async addToWaitlist(
    input: WaitlistInput,
    userId?: string,
  ): Promise<WaitlistResult> {
    // Guard: active users must not join waitlist (would lose access)
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { betaStatus: true },
      });
      if (user?.betaStatus === "active") {
        return { position: 0, alreadyExists: false, rejected: true };
      }
    }

    // Upsert-style: try create, catch unique constraint (P2002) for duplicates
    // This avoids the TOCTOU race between findUnique + create
    try {
      await prisma.betaWaitlist.create({
        data: {
          email: input.email,
          name: input.name,
          userId: userId ?? undefined,
          // Prisma.InputJsonValue boundary: metadata is validated upstream in controller
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error: unknown) {
      // P2002 = unique constraint violation (duplicate email)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const position = await BetaService.getWaitlistPosition(input.email);
        return { position, alreadyExists: true, rejected: false };
      }
      throw error;
    }

    // Atomic conditional update: prevents race where user becomes active
    // between the guard check above and this update (BM-003)
    if (userId) {
      await prisma.user.updateMany({
        where: { id: userId, betaStatus: { not: "active" } },
        data: { betaStatus: "waitlist" },
      });
    }

    const position = await BetaService.getWaitlistPosition(input.email);

    logger.log(
      `[BETA_SERVICE] Waitlist entry created: ${input.email} (position: ${position})`,
    );

    return { position, alreadyExists: false, rejected: false };
  }

  /**
   * Reactivates a deactivated user account
   * Only works for inactive / pending_reactivation statuses
   */
  static async reactivateUser(
    userId: string,
  ): Promise<{ success: boolean; error?: string; code?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { betaStatus: true },
    });

    if (!user) {
      return {
        success: false,
        error: "User not found",
        code: "USER_NOT_FOUND",
      };
    }

    // Only inactive or pending_reactivation can reactivate
    const reactivatableStatuses: BetaStatus[] = [
      "inactive",
      "pending_reactivation",
    ];

    if (!reactivatableStatuses.includes(user.betaStatus)) {
      return {
        success: false,
        error: `Cannot reactivate from status: ${user.betaStatus}`,
        code: "INVALID_STATUS",
      };
    }

    // Atomic transaction with bounded retry for serialization conflicts (PEN-138)
    // Under high concurrency, Serializable isolation can fail with P2034
    try {
      await BetaService.executeReactivationTransaction(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "NO_SPOTS_AVAILABLE") {
        return {
          success: false,
          error: "No beta spots available",
          code: "NO_SPOTS_AVAILABLE",
        };
      }
      throw error;
    }

    // Invalidate cached active count since a user just became active
    await redis.del(STATUS_CACHE_KEY).catch(() => {});

    logger.log(`[BETA_SERVICE] User reactivated: ${userId}`);

    return { success: true };
  }

  /**
   * Executes reactivation transaction with bounded retry on serialization conflicts.
   * Prisma P2034 = "Transaction failed due to write conflict or deadlock"
   * Under concurrent reactivation waves, Serializable isolation causes transient failures.
   */
  private static async executeReactivationTransaction(
    userId: string,
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
                betaDeactivatedAt: undefined,
                betaReactivationDeadline: undefined,
                weeklyActiveTimeSeconds: 0,
                weeklySessionCount: 0,
                lastActiveAt: now,
              },
            });

            await tx.betaWaitlist.deleteMany({
              where: { userId },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error: unknown) {
        // NO_SPOTS_AVAILABLE is business logic, not a transient error — propagate immediately
        const message = error instanceof Error ? error.message : String(error);
        if (message === "NO_SPOTS_AVAILABLE") {
          throw error;
        }

        // P2034 = serialization failure — retry with exponential backoff
        const isSerializationError =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (!isSerializationError || attempt === SERIALIZATION_MAX_RETRIES) {
          logger.error(
            `[BETA_SERVICE] Reactivation transaction failed after ${attempt} attempt(s):`,
            error,
          );
          throw error;
        }

        const delayMs = SERIALIZATION_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[BETA_SERVICE] Serialization conflict on reactivation (attempt ${attempt}/${SERIALIZATION_MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Returns the FIFO position in the waitlist for a given email
   */
  private static async getWaitlistPosition(email: string): Promise<number> {
    const entry = await prisma.betaWaitlist.findUnique({
      where: { email },
      select: { joinedAt: true },
    });

    if (!entry) return 0;

    const position = await prisma.betaWaitlist.count({
      where: {
        joinedAt: { lte: entry.joinedAt },
      },
    });

    return position;
  }
}
