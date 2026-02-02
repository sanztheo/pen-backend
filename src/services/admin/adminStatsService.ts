/**
 * Admin Stats Service
 * Aggregates metrics for user, revenue, usage, and moderation data
 * Uses Redis cache for expensive dashboard queries (3 min TTL)
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import {
  UserMetrics,
  RevenueMetrics,
  UsageMetrics,
  PaginatedLogs,
  ModerationFilters,
  UserListFilters,
  PaginatedUsers,
  PaginatedUserPages,
} from "../../types/admin.types.js";
import { Prisma } from "@prisma/client";
import { z } from "zod";

// Monthly premium price (adjust based on your pricing model)
const MONTHLY_PREMIUM_PRICE = 9.99;

// Cache configuration
const CACHE_NAMESPACE = "admin";
const DASHBOARD_CACHE_TTL = 180; // 3 minutes

const UserMetricsSchema = z.object({
  totalUsers: z.number(),
  activeUsers: z.number(),
  newUsers: z.number(),
  churnRate: z.number(),
  growthRate: z.number(),
}) satisfies z.ZodType<UserMetrics>;

const RevenueMetricsSchema = z.object({
  mrr: z.number(),
  totalRevenue: z.number(),
  freeUsers: z.number(),
  premiumUsers: z.number(),
  conversionRate: z.number(),
  arpu: z.number(),
}) satisfies z.ZodType<RevenueMetrics>;

const UsageMetricsSchema = z.object({
  totalAICreditsUsed: z.number(),
  avgCreditsPerUser: z.number(),
  totalQuizzesGenerated: z.number(),
  avgQuizzesPerUser: z.number(),
  topUsers: z.array(
    z.object({
      userId: z.string(),
      email: z.string(),
      creditsUsed: z.number(),
    }),
  ),
}) satisfies z.ZodType<UsageMetrics>;

const DashboardMetricsSchema = z.object({
  users: UserMetricsSchema,
  revenue: RevenueMetricsSchema,
  usage: UsageMetricsSchema,
});

export class AdminStatsService {
  /**
   * Get user-related metrics
   * Growth rate = (new users this period - new users last period) / last period
   */
  static async getUserMetrics(): Promise<UserMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      newUsersThisWeek,
      newUsersPreviousWeek,
      inactiveUsers,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({
        where: {
          isActive: true,
          lastLoginAt: { gte: thirtyDaysAgo },
        },
      }),
      // New users this week (last 7 days)
      prisma.user.count({
        where: {
          isActive: true,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      // New users previous week (7-14 days ago)
      prisma.user.count({
        where: {
          isActive: true,
          createdAt: { lt: sevenDaysAgo, gte: fourteenDaysAgo },
        },
      }),
      prisma.user.count({
        where: {
          isActive: true,
          OR: [{ lastLoginAt: { lt: thirtyDaysAgo } }, { lastLoginAt: null }],
        },
      }),
    ]);

    const churnRate = totalUsers > 0 ? (inactiveUsers / totalUsers) * 100 : 0;

    // FIX: Compare new users this week vs previous week (week-over-week growth)
    const growthRate =
      newUsersPreviousWeek > 0
        ? ((newUsersThisWeek - newUsersPreviousWeek) / newUsersPreviousWeek) *
          100
        : newUsersThisWeek > 0
          ? 100
          : 0;

    return {
      totalUsers,
      activeUsers,
      newUsers: newUsersThisWeek,
      churnRate: Math.round(churnRate * 100) / 100,
      growthRate: Math.round(growthRate * 100) / 100,
    };
  }

  /**
   * Get revenue-related metrics
   * FIX: Free users = total users - premium users (not just subscription records)
   */
  static async getRevenueMetrics(): Promise<RevenueMetrics> {
    const [premiumUsersCount, totalUsersCount] = await Promise.all([
      prisma.userSubscription.count({
        where: { plan: "premium", status: "active" },
      }),
      prisma.user.count({ where: { isActive: true } }),
    ]);

    // FIX: Users without subscription OR with free_user plan are free
    const freeUsersCount = totalUsersCount - premiumUsersCount;

    const mrr = premiumUsersCount * MONTHLY_PREMIUM_PRICE;
    const totalRevenue = mrr; // Expand with historical data later
    const conversionRate =
      totalUsersCount > 0 ? (premiumUsersCount / totalUsersCount) * 100 : 0;
    const arpu = totalUsersCount > 0 ? mrr / totalUsersCount : 0;

    return {
      mrr: Math.round(mrr * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      freeUsers: freeUsersCount,
      premiumUsers: premiumUsersCount,
      conversionRate: Math.round(conversionRate * 100) / 100,
      arpu: Math.round(arpu * 100) / 100,
    };
  }

  /**
   * Get usage-related metrics
   */
  static async getUsageMetrics(): Promise<UsageMetrics> {
    const [creditsAgg, quizCount, totalUsers, topUsersData] = await Promise.all(
      [
        prisma.userLimits.aggregate({
          _sum: { aiCreditsUsed: true },
        }),
        prisma.quiz.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.userLimits.findMany({
          where: { aiCreditsUsed: { gt: 0 } },
          orderBy: { aiCreditsUsed: "desc" },
          take: 10,
          include: {
            user: {
              select: { id: true, email: true },
            },
          },
        }),
      ],
    );

    const totalAICreditsUsed = creditsAgg._sum.aiCreditsUsed || 0;
    const avgCreditsPerUser =
      totalUsers > 0 ? totalAICreditsUsed / totalUsers : 0;
    const avgQuizzesPerUser = totalUsers > 0 ? quizCount / totalUsers : 0;

    const topUsers = topUsersData.map((ul) => ({
      userId: ul.user.id,
      email: ul.user.email,
      creditsUsed: ul.aiCreditsUsed,
    }));

    return {
      totalAICreditsUsed: Math.round(totalAICreditsUsed * 100) / 100,
      avgCreditsPerUser: Math.round(avgCreditsPerUser * 100) / 100,
      totalQuizzesGenerated: quizCount,
      avgQuizzesPerUser: Math.round(avgQuizzesPerUser * 100) / 100,
      topUsers,
    };
  }

  /**
   * Get moderation logs with pagination and filters
   */
  static async getModerationLogs(
    filters: ModerationFilters,
  ): Promise<PaginatedLogs> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100); // Max 100 per page
    const skip = (page - 1) * limit;

    const where: {
      userId?: string;
      action?: { contains: string; mode: "insensitive" };
      createdAt?: { gte?: Date; lte?: Date };
    } = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }
    if (filters.action) {
      where.action = { contains: filters.action, mode: "insensitive" };
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: { email: true },
          },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    return {
      logs: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userEmail: log.user?.email || "Unknown",
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId || undefined,
        details: log.details as Record<string, unknown>,
        createdAt: log.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Toggle user active status (ban/unban)
   * Uses transaction to prevent TOCTOU race condition
   */
  static async toggleUserStatus(
    userId: string,
    isActive: boolean,
    adminUserId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Security: Prevent self-deactivation (defense-in-depth)
    if (userId === adminUserId && !isActive) {
      return {
        success: false,
        error: "Impossible de désactiver votre propre compte",
      };
    }

    // Transaction to prevent race condition between check and update
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, isAdmin: true },
      });

      if (!user) {
        return { success: false, error: "Utilisateur non trouvé" };
      }

      // Prevent deactivating another admin
      if (user.isAdmin && !isActive) {
        return {
          success: false,
          error: "Impossible de désactiver un administrateur",
        };
      }

      await tx.user.update({
        where: { id: userId },
        data: { isActive },
      });

      // Audit trail
      await tx.activityLog.create({
        data: {
          userId: adminUserId,
          action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
          entityType: "user",
          entityId: userId,
          details: { targetUserId: userId, newStatus: isActive },
        },
      });

      return { success: true };
    });
  }

  /**
   * Get all dashboard metrics in one call
   * Uses Redis cache to reduce DB load (3 min TTL)
   */
  static async getDashboardMetrics() {
    return redisCache.getOrSet(
      "dashboard:metrics",
      async () => {
        const [users, revenue, usage] = await Promise.all([
          this.getUserMetrics(),
          this.getRevenueMetrics(),
          this.getUsageMetrics(),
        ]);
        return { users, revenue, usage };
      },
      (value) => DashboardMetricsSchema.parse(value),
      { namespace: CACHE_NAMESPACE, ttl: DASHBOARD_CACHE_TTL },
    );
  }

  /**
   * Invalidate dashboard cache (call after significant data changes)
   */
  static async invalidateDashboardCache(): Promise<void> {
    await redisCache.invalidate("dashboard:metrics", {
      namespace: CACHE_NAMESPACE,
    });
  }

  /**
   * Get paginated list of users with stats
   */
  static async getUserList(filters: UserListFilters): Promise<PaginatedUsers> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (filters.search) {
      where.OR = [
        { email: { contains: filters.search, mode: "insensitive" } },
        { firstName: { contains: filters.search, mode: "insensitive" } },
        { lastName: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          isActive: true,
          isAdmin: true,
          createdAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              ownedWorkspaces: true,
              // FIX: Only count non-archived pages (consistent with getUserPages)
              pages: { where: { isArchived: false } },
            },
          },
          subscription: {
            select: { plan: true, status: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarUrl: u.avatarUrl,
        isActive: u.isActive,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        workspacesCount: u._count.ownedWorkspaces,
        pagesCount: u._count.pages,
        plan: (u.subscription?.plan as "free_user" | "premium") || "free_user",
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get paginated list of pages for a specific user (admin access)
   */
  static async getUserPages(
    userId: string,
    page = 1,
    limit = 50,
  ): Promise<PaginatedUserPages> {
    const skip = (page - 1) * Math.min(limit, 100);
    const take = Math.min(limit, 100);

    const [pages, total] = await Promise.all([
      prisma.page.findMany({
        where: { createdBy: userId, isArchived: false },
        orderBy: { updatedAt: "desc" },
        skip,
        take,
        include: {
          workspace: {
            select: { name: true },
          },
          project: {
            select: { name: true },
          },
        },
      }),
      prisma.page.count({ where: { createdBy: userId, isArchived: false } }),
    ]);

    return {
      pages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        icon: p.icon,
        iconColor: p.iconColor,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        workspaceName: p.workspace?.name || "Sans workspace",
        projectName: p.project?.name || null,
      })),
      total,
      page,
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }
}
