/**
 * Beta Admin Service
 * Handles beta user management operations for the admin dashboard
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import { logger } from "../../utils/logger.js";
import { Prisma, BetaStatus } from "@prisma/client";
import { z } from "zod";
import type {
  BetaMetricsResponse,
  BetaUserListFilters,
  PaginatedBetaUsers,
  BetaActionResult,
  BetaBulkResult,
} from "../../types/admin.types.js";
import {
  TOTAL_BETA_SPOTS,
  SERIALIZATION_MAX_RETRIES,
  SERIALIZATION_BASE_DELAY_MS,
} from "../BetaService.types.js";

// ─── Cache configuration ────────────────────────────────────────
const CACHE_NAMESPACE = "admin";
const BETA_METRICS_TTL = 180; // 3 minutes

// ─── Allowed sort columns ───────────────────────────────────────
const ALLOWED_SORT_COLUMNS = new Set([
  "betaJoinedAt",
  "lastHeartbeatAt",
  "weeklyActiveTimeSeconds",
  "totalActiveTimeSeconds",
  "email",
  "firstName",
  "lastName",
  "betaDeactivatedAt",
]);

// ─── Zod schemas for cache validation ───────────────────────────
const BetaTrendPointSchema = z.object({
  date: z.string(),
  active: z.number(),
  waitlist: z.number(),
  newActivations: z.number(),
});

const BetaMetricsResponseSchema = z.object({
  cards: z.object({
    spotsUsed: z.number(),
    totalSpots: z.number(),
    waitlistCount: z.number(),
    activeThisWeek: z.number(),
    inactive7d: z.number(),
    expired: z.number(),
  }),
  trend: z.array(BetaTrendPointSchema),
}) satisfies z.ZodType<BetaMetricsResponse>;

function parseBetaMetrics(value: unknown): BetaMetricsResponse {
  return BetaMetricsResponseSchema.parse(value);
}

export class BetaAdminService {
  /**
   * Get beta metrics cards + trend data for a given period (7 or 30 days)
   */
  static async getBetaMetrics(period: number): Promise<BetaMetricsResponse> {
    const cacheKey = `admin:beta:metrics:${period}`;

    return redisCache.getOrSet(
      cacheKey,
      async () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [spotsUsed, waitlistCount, activeThisWeek, inactive7d, expired] = await Promise.all([
          prisma.user.count({ where: { betaStatus: "active" } }),
          prisma.betaWaitlist.count(),
          prisma.user.count({
            where: {
              betaStatus: "active",
              lastHeartbeatAt: { gte: sevenDaysAgo },
            },
          }),
          prisma.user.count({ where: { betaStatus: "inactive" } }),
          prisma.user.count({ where: { betaStatus: "expired" } }),
        ]);

        const trend = await BetaAdminService.getTrendData(period);

        return {
          cards: {
            spotsUsed,
            totalSpots: TOTAL_BETA_SPOTS,
            waitlistCount,
            activeThisWeek,
            inactive7d,
            expired,
          },
          trend,
        };
      },
      parseBetaMetrics,
      { namespace: CACHE_NAMESPACE, ttl: BETA_METRICS_TTL },
    );
  }

  /**
   * Build daily trend data using generate_series SQL
   */
  private static async getTrendData(period: number): Promise<BetaMetricsResponse["trend"]> {
    // Use correlated subqueries instead of LEFT JOIN to avoid cartesian product
    const rows = await prisma.$queryRaw<
      Array<{
        date: Date;
        active: bigint;
        new_activations: bigint;
      }>
    >(Prisma.sql`
      SELECT d::date AS date,
        (SELECT COUNT(*) FROM users u
         WHERE u.beta_joined_at <= d
         AND (u.beta_deactivated_at IS NULL OR u.beta_deactivated_at > d)
         AND u.beta_status IS NOT NULL
        ) AS active,
        (SELECT COUNT(*) FROM users u
         WHERE u.beta_joined_at::date = d::date
        ) AS new_activations
      FROM generate_series(
        CURRENT_DATE - ${period}::int,
        CURRENT_DATE,
        '1 day'::interval
      ) AS d
      ORDER BY d::date
    `);

    // Waitlist count is a point-in-time value; approximate as current for trend
    const currentWaitlist = await prisma.betaWaitlist.count();

    return rows.map((row) => ({
      date: new Date(row.date).toISOString().split("T")[0],
      active: Number(row.active),
      waitlist: currentWaitlist,
      newActivations: Number(row.new_activations),
    }));
  }

  /**
   * Get paginated beta users with filters and sorting
   */
  static async getBetaUsers(filters: BetaUserListFilters): Promise<PaginatedBetaUsers> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(Math.max(1, filters.limit ?? 20), 100);
    const skip = (page - 1) * limit;

    const validStatuses: BetaStatus[] = [
      "active",
      "inactive",
      "waitlist",
      "pending_reactivation",
      "expired",
    ];
    const where: Prisma.UserWhereInput = {
      betaStatus: { in: validStatuses },
    };

    if (filters.betaStatus && validStatuses.includes(filters.betaStatus as BetaStatus)) {
      where.betaStatus = filters.betaStatus as BetaStatus;
    }

    if (filters.search) {
      const searchTerm = filters.search.trim();
      if (searchTerm.length > 0) {
        where.OR = [
          { firstName: { contains: searchTerm, mode: "insensitive" } },
          { lastName: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } },
        ];
      }
    }

    const sortBy =
      filters.sortBy && ALLOWED_SORT_COLUMNS.has(filters.sortBy) ? filters.sortBy : "betaJoinedAt";
    const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          betaStatus: true,
          lastHeartbeatAt: true,
          weeklyActiveTimeSeconds: true,
          totalActiveTimeSeconds: true,
          betaJoinedAt: true,
          betaDeactivatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        ...u,
        betaStatus: u.betaStatus ?? "unknown",
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Kick (deactivate) a beta user with audit logging
   */
  static async kickUser(
    userId: string,
    adminId: string,
    reason?: string,
  ): Promise<BetaActionResult> {
    const now = new Date();
    const reactivationDeadline = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, betaStatus: "active" },
        data: {
          betaStatus: "inactive",
          betaDeactivatedAt: now,
          betaReactivationDeadline: reactivationDeadline,
        },
      });

      if (updated.count === 0) {
        return { success: false as const, error: "Utilisateur non actif ou introuvable" };
      }

      await tx.activityLog.create({
        data: {
          userId: adminId,
          action: "BETA_USER_KICKED",
          entityType: "user",
          entityId: userId,
          details: JSON.parse(JSON.stringify({ adminId, reason: reason ?? null })),
        },
      });

      return { success: true as const };
    });

    if (result.success) {
      await BetaAdminService.invalidateMetricsCache();
    }

    return result;
  }

  /**
   * Promote a user to active beta status using serializable transaction
   * with P2034 retry (same pattern as BetaCronService.executeWaitlistPromotion)
   */
  static async promoteUser(userId: string, adminId: string): Promise<BetaActionResult> {
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

            const user = await tx.user.findUnique({
              where: { id: userId },
              select: { betaStatus: true },
            });

            if (!user) {
              throw new Error("USER_NOT_FOUND");
            }

            const promotableStatuses = new Set([
              "waitlist",
              "pending_reactivation",
              "expired",
              "inactive",
            ]);

            if (!promotableStatuses.has(user.betaStatus ?? "")) {
              throw new Error("STATUS_NOT_PROMOTABLE");
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
              },
            });

            await tx.betaWaitlist.deleteMany({ where: { userId } });

            await tx.activityLog.create({
              data: {
                userId: adminId,
                action: "BETA_USER_PROMOTED",
                entityType: "user",
                entityId: userId,
                details: JSON.parse(JSON.stringify({ adminId })),
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        await BetaAdminService.invalidateMetricsCache();
        return { success: true };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (message === "NO_SPOTS_AVAILABLE") {
          return { success: false, error: "Plus de places beta disponibles" };
        }
        if (message === "USER_NOT_FOUND") {
          return { success: false, error: "Utilisateur introuvable" };
        }
        if (message === "STATUS_NOT_PROMOTABLE") {
          return {
            success: false,
            error: "Statut utilisateur incompatible avec la promotion",
          };
        }

        const isSerializationError =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

        if (!isSerializationError || attempt === SERIALIZATION_MAX_RETRIES) {
          logger.error(
            `[BETA_ADMIN] promoteUser transaction failed after ${attempt} attempt(s):`,
            error,
          );
          throw error;
        }

        const delayMs = SERIALIZATION_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `[BETA_ADMIN] Serialization conflict on promotion (attempt ${attempt}/${SERIALIZATION_MAX_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Unreachable, but satisfies TypeScript
    return { success: false, error: "Erreur inattendue" };
  }

  /**
   * Execute bulk kick or promote actions on multiple users
   */
  static async bulkAction(
    userIds: string[],
    action: "kick" | "promote",
    adminId: string,
    reason?: string,
  ): Promise<BetaBulkResult> {
    const result: BetaBulkResult = {
      total: userIds.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (const userId of userIds) {
      try {
        const actionResult =
          action === "kick"
            ? await BetaAdminService.kickUser(userId, adminId, reason)
            : await BetaAdminService.promoteUser(userId, adminId);

        if (actionResult.success) {
          result.succeeded++;
        } else {
          result.failed++;
          result.errors.push({
            userId,
            error: actionResult.error ?? "Erreur inconnue",
          });
        }
      } catch (error: unknown) {
        result.failed++;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ userId, error: message });
      }
    }

    // Single cache invalidation at the end
    await BetaAdminService.invalidateMetricsCache();

    return result;
  }

  /**
   * Invalidate beta metrics cache for both periods
   */
  private static async invalidateMetricsCache(): Promise<void> {
    await Promise.all([
      redisCache.invalidate("admin:beta:metrics:7", {
        namespace: CACHE_NAMESPACE,
      }),
      redisCache.invalidate("admin:beta:metrics:30", {
        namespace: CACHE_NAMESPACE,
      }),
    ]);
  }
}
