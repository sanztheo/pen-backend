/**
 * Trends Metrics Service
 * Computes time-series data for admin dashboard trend charts.
 * Aggregates by day (7d/30d) or by week (90d).
 * Cached in Redis with 15 min TTL.
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import { z } from "zod";
import { TrendPeriod, TrendDataPoint, TrendsMetricsResponse } from "../../types/admin.types.js";

const CACHE_NAMESPACE = "admin";
const TRENDS_CACHE_TTL = 900; // 15 minutes

const PERIOD_DAYS: Record<TrendPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const TrendDataPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

const TrendsMetricsSchema = z.object({
  period: z.enum(["7d", "30d", "90d"]),
  granularity: z.enum(["day", "week"]),
  metrics: z.object({
    users: z.array(TrendDataPointSchema),
    mrr: z.array(TrendDataPointSchema),
    credits: z.array(TrendDataPointSchema),
    quizzes: z.array(TrendDataPointSchema),
  }),
}) satisfies z.ZodType<TrendsMetricsResponse>;

// Monthly premium price (consistent with adminStatsService)
const MONTHLY_PREMIUM_PRICE = 9.99;

export class TrendsMetricsService {
  /**
   * Get trends metrics for a given period, with Redis cache.
   */
  static async getTrends(period: TrendPeriod): Promise<TrendsMetricsResponse> {
    const cacheKey = `metrics:trends:${period}`;

    return redisCache.getOrSet(
      cacheKey,
      () => this.computeTrends(period),
      (value) => TrendsMetricsSchema.parse(value),
      { namespace: CACHE_NAMESPACE, ttl: TRENDS_CACHE_TTL },
    );
  }

  /**
   * Compute trends from database (called on cache miss).
   */
  private static async computeTrends(period: TrendPeriod): Promise<TrendsMetricsResponse> {
    const days = PERIOD_DAYS[period];
    const granularity = period === "90d" ? "week" : "day";
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const [users, mrr, credits, quizzes] = await Promise.all([
      this.getUserSignupTrend(startDate, granularity),
      this.getMrrTrend(startDate, granularity),
      this.getCreditsTrend(startDate, granularity),
      this.getQuizzesTrend(startDate, granularity),
    ]);

    return { period, granularity, metrics: { users, mrr, credits, quizzes } };
  }

  /**
   * New user signups per day/week.
   */
  private static async getUserSignupTrend(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<TrendDataPoint[]> {
    const truncExpr = granularity === "week" ? "week" : "day";

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc(${truncExpr}, created_at) AS bucket,
             COUNT(*)::bigint AS count
      FROM users
      WHERE created_at >= ${startDate}
        AND is_active = true
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((r) => ({
      date: formatBucket(r.bucket, granularity),
      value: Number(r.count),
    }));
  }

  /**
   * MRR evolution: count of active premium subscriptions at each bucket * price.
   * Uses subscription creation date for trend bucketing.
   */
  private static async getMrrTrend(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<TrendDataPoint[]> {
    const truncExpr = granularity === "week" ? "week" : "day";

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc(${truncExpr}, created_at) AS bucket,
             COUNT(*)::bigint AS count
      FROM user_subscriptions
      WHERE created_at >= ${startDate}
        AND plan = 'premium'
        AND status = 'active'
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((r) => ({
      date: formatBucket(r.bucket, granularity),
      value: Math.round(Number(r.count) * MONTHLY_PREMIUM_PRICE * 100) / 100,
    }));
  }

  /**
   * AI credits consumed per day/week (from usage_records with resource_type='ai_credit').
   */
  private static async getCreditsTrend(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<TrendDataPoint[]> {
    const truncExpr = granularity === "week" ? "week" : "day";

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; total: number | null }>>`
      SELECT date_trunc(${truncExpr}, created_at) AS bucket,
             SUM(quantity)::float AS total
      FROM usage_records
      WHERE created_at >= ${startDate}
        AND resource_type = 'ai_credit'
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((r) => ({
      date: formatBucket(r.bucket, granularity),
      value: Math.round((r.total ?? 0) * 100) / 100,
    }));
  }

  /**
   * Quizzes generated per day/week.
   */
  private static async getQuizzesTrend(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<TrendDataPoint[]> {
    const truncExpr = granularity === "week" ? "week" : "day";

    const rows = await prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc(${truncExpr}, created_at) AS bucket,
             COUNT(*)::bigint AS count
      FROM quizzes
      WHERE created_at >= ${startDate}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return rows.map((r) => ({
      date: formatBucket(r.bucket, granularity),
      value: Number(r.count),
    }));
  }
}

/**
 * Format a date_trunc bucket into a readable string.
 * Day: "2026-02-27", Week: "2026-W09"
 */
function formatBucket(bucket: Date, granularity: "day" | "week"): string {
  if (granularity === "week") {
    const year = bucket.getFullYear();
    const weekNum = getISOWeekNumber(bucket);
    return `${year}-W${String(weekNum).padStart(2, "0")}`;
  }
  return bucket.toISOString().split("T")[0];
}

/**
 * ISO 8601 week number calculation.
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
