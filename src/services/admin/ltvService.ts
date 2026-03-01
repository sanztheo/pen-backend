/**
 * LTV (Lifetime Value) Service
 * Computes estimated LTV per segment: by plan and by activity level.
 * Formula: LTV = ARPU × (1 / monthly_churn_rate)
 * Cache: Redis 24h
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import { logger } from "../../utils/logger.js";
import { z } from "zod";
import { LtvSegment, LtvMetricsResponse } from "../../types/admin.types.js";

const CACHE_NAMESPACE = "admin";
const LTV_CACHE_KEY = "metrics:ltv";
const LTV_CACHE_TTL = 86400; // 24 hours

const MONTHLY_PREMIUM_PRICE = 9.99;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const LtvSegmentSchema = z.object({
  name: z.string(),
  userCount: z.number(),
  arpu: z.number(),
  churnRate: z.number(),
  ltv: z.number(),
});

const LtvMetricsSchema = z.object({
  segments: z.array(LtvSegmentSchema),
  computedAt: z.string(),
}) satisfies z.ZodType<LtvMetricsResponse>;

export class LtvService {
  /**
   * Get LTV metrics from cache or compute fresh.
   */
  static async getLtvMetrics(): Promise<LtvMetricsResponse> {
    return redisCache.getOrSet(
      LTV_CACHE_KEY,
      () => LtvService.computeLtv(),
      (value) => LtvMetricsSchema.parse(value),
      { namespace: CACHE_NAMESPACE, ttl: LTV_CACHE_TTL },
    );
  }

  /**
   * Compute LTV for each segment.
   */
  private static async computeLtv(): Promise<LtvMetricsResponse> {
    logger.log("[LTV_SERVICE] Computing LTV metrics...");

    const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS);

    const [planSegments, activitySegments] = await Promise.all([
      LtvService.computePlanSegments(ninetyDaysAgo),
      LtvService.computeActivitySegments(ninetyDaysAgo),
    ]);

    const segments = [...planSegments, ...activitySegments];

    logger.log(`[LTV_SERVICE] Computed ${segments.length} segments`);

    return {
      segments,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Segments by subscription plan: free_user vs premium.
   */
  private static async computePlanSegments(since: Date): Promise<LtvSegment[]> {
    // Premium users: active subscription with plan=premium
    const [premiumTotal, premiumChurned] = await Promise.all([
      prisma.userSubscription.count({
        where: { plan: "premium" },
      }),
      prisma.userSubscription.count({
        where: {
          plan: "premium",
          canceledAt: { gte: since },
        },
      }),
    ]);

    // Free users: no subscription or plan=free_user
    const totalUsers = await prisma.user.count({ where: { isActive: true } });
    const freeTotal = totalUsers - premiumTotal;

    // Free users who became inactive (last login > 90 days ago = churned)
    const freeChurned = await prisma.user.count({
      where: {
        isActive: true,
        OR: [{ subscription: null }, { subscription: { plan: "free_user" } }],
        lastLoginAt: { lt: since },
      },
    });

    return [
      LtvService.buildSegment("Plan: Free", freeTotal, 0, freeChurned),
      LtvService.buildSegment("Plan: Premium", premiumTotal, MONTHLY_PREMIUM_PRICE, premiumChurned),
    ];
  }

  /**
   * Segments by activity level: power / regular / low.
   * Power: >20h total active time
   * Regular: 2-20h
   * Low: <2h
   */
  private static async computeActivitySegments(since: Date): Promise<LtvSegment[]> {
    const POWER_THRESHOLD = 20 * 3600; // 20 hours in seconds
    const REGULAR_THRESHOLD = 2 * 3600; // 2 hours in seconds

    // Count users by activity level with premium status
    const [powerUsers, regularUsers, lowUsers] = await Promise.all([
      LtvService.getActivitySegmentData("power", POWER_THRESHOLD, null, since),
      LtvService.getActivitySegmentData("regular", REGULAR_THRESHOLD, POWER_THRESHOLD, since),
      LtvService.getActivitySegmentData("low", 0, REGULAR_THRESHOLD, since),
    ]);

    return [powerUsers, regularUsers, lowUsers];
  }

  /**
   * Get user count, premium ratio, and churn for an activity segment.
   */
  private static async getActivitySegmentData(
    label: string,
    minSeconds: number,
    maxSeconds: number | null,
    since: Date,
  ): Promise<LtvSegment> {
    const activityFilter: Record<string, unknown> = {
      gte: minSeconds,
    };
    if (maxSeconds !== null) {
      activityFilter.lt = maxSeconds;
    }

    const where = {
      isActive: true,
      totalActiveTimeSeconds: activityFilter,
    };

    const [total, premiumCount, churned] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({
        where: {
          ...where,
          subscription: { plan: "premium", status: "active" },
        },
      }),
      prisma.user.count({
        where: {
          ...where,
          lastLoginAt: { lt: since },
        },
      }),
    ]);

    // ARPU = (premium users in segment × price) / total users in segment
    const arpu = total > 0 ? (premiumCount * MONTHLY_PREMIUM_PRICE) / total : 0;
    const displayLabel = `Activité: ${label.charAt(0).toUpperCase() + label.slice(1)}`;

    return LtvService.buildSegment(displayLabel, total, arpu, churned);
  }

  /**
   * Build a segment with LTV calculation.
   * LTV = ARPU × (1 / monthly_churn_rate)
   * Churn rate is annualized from 90-day data: (churned/total) / 3 months
   */
  private static buildSegment(
    name: string,
    userCount: number,
    arpu: number,
    churned: number,
  ): LtvSegment {
    // Monthly churn rate from 90-day window
    const churnRate90d = userCount > 0 ? churned / userCount : 0;
    const monthlyChurnRate = churnRate90d / 3; // 90 days ≈ 3 months

    // LTV = ARPU × (1 / monthly_churn_rate)
    // Cap at 100x ARPU to avoid infinity when churn = 0
    const ltv = monthlyChurnRate > 0 ? arpu / monthlyChurnRate : arpu * 100; // No churn → cap at 100 months

    return {
      name,
      userCount,
      arpu: Math.round(arpu * 100) / 100,
      churnRate: Math.round(monthlyChurnRate * 10000) / 100, // as percentage
      ltv: Math.round(ltv * 100) / 100,
    };
  }
}
