/**
 * AI Cost Service
 * Aggregates cost data from OpenaiUsageLog for the admin dashboard "AI Costs" tab.
 * Cached in Redis with 5 min TTL.
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import { logger } from "../../utils/logger.js";
import { MODEL_REGISTRY } from "../../config/models.js";
import type {
  AICostByModel,
  AICostByProvider,
  AICostBySource,
  AICostTopUser,
  AICostTrendBySourcePoint,
  CreditsBySource,
  PeriodComparison,
  ProviderBalance,
  AICostTrendPoint,
  AICostsResponse,
  TrendPeriod,
} from "../../types/admin.types.js";
import { z } from "zod";

// ── Cache config ────────────────────────────────────────────────────────────

const CACHE_NAMESPACE = "admin";
const AI_COSTS_CACHE_TTL = 300; // 5 minutes

const PERIOD_DAYS: Record<TrendPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

// ── Zod schemas for cache parsing ───────────────────────────────────────────

const AICostByModelSchema = z.object({
  model: z.string(),
  provider: z.string(),
  totalCost: z.number(),
  totalRequests: z.number(),
  totalPromptTokens: z.number(),
  totalCompletionTokens: z.number(),
  avgCostPerRequest: z.number(),
});

const AICostByProviderSchema = z.object({
  provider: z.string(),
  totalCost: z.number(),
  totalRequests: z.number(),
  models: z.array(AICostByModelSchema),
});

const AICostTopUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  totalCost: z.number(),
  totalRequests: z.number(),
  aiCreditsUsed: z.number(),
  topModel: z.string(),
});

const ProviderBalanceSchema = z.object({
  provider: z.string(),
  available: z.boolean(),
  balance: z.number().optional(),
  currency: z.string().optional(),
  error: z.string().optional(),
});

const AICostTrendPointSchema = z.object({
  date: z.string(),
  cost: z.number(),
  requests: z.number(),
});

const AICostBySourceSchema = z.object({
  source: z.string(),
  totalCost: z.number(),
  totalRequests: z.number(),
  avgCostPerRequest: z.number(),
});

const CreditsBySourceSchema = z.object({
  source: z.string(),
  totalCredits: z.number(),
  totalRecords: z.number(),
});

const PeriodComparisonSchema = z.object({
  currentCost: z.number(),
  previousCost: z.number(),
  costChangePercent: z.number(),
  currentCredits: z.number(),
  previousCredits: z.number(),
  creditsChangePercent: z.number(),
  currentRequests: z.number(),
  previousRequests: z.number(),
  requestsChangePercent: z.number(),
});

const AICostTrendBySourcePointSchema = z.object({
  date: z.string(),
  sources: z.record(z.string(), z.number()),
});

const AICostsResponseSchema = z.object({
  byModel: z.array(AICostByModelSchema),
  byProvider: z.array(AICostByProviderSchema),
  topUsers: z.array(AICostTopUserSchema),
  trend: z.array(AICostTrendPointSchema),
  balances: z.array(ProviderBalanceSchema),
  bySource: z.array(AICostBySourceSchema),
  creditsBySource: z.array(CreditsBySourceSchema),
  comparison: PeriodComparisonSchema,
  trendBySource: z.array(AICostTrendBySourcePointSchema),
});

// ── Service ─────────────────────────────────────────────────────────────────

export class AICostService {
  /** Main entry point -- returns complete AI costs data, cached 5 min. */
  static async getAICosts(period: TrendPeriod): Promise<AICostsResponse> {
    const cacheKey = `ai-costs:${period}`;

    return redisCache.getOrSet(
      cacheKey,
      () => this.computeAICosts(period),
      (value) => AICostsResponseSchema.parse(value),
      { namespace: CACHE_NAMESPACE, ttl: AI_COSTS_CACHE_TTL },
    );
  }

  private static async computeAICosts(period: TrendPeriod): Promise<AICostsResponse> {
    const days = PERIOD_DAYS[period];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const granularity = period === "90d" ? "week" : "day";

    // Run all independent DB queries in parallel (getCostsByProvider is in-memory, runs after)
    const [
      byModel,
      topUsers,
      trend,
      balances,
      bySource,
      creditsBySource,
      comparison,
      trendBySource,
    ] = await Promise.all([
      this.getCostsByModel(startDate),
      this.getTopUsersByCost(startDate),
      this.getCostTrend(startDate, granularity),
      this.getProviderBalances(),
      this.getCostsBySource(startDate),
      this.getCreditsBySource(startDate),
      this.getPeriodComparison(days),
      this.getCostTrendBySource(startDate, granularity),
    ]);

    // In-memory aggregation, no DB call
    const byProvider = await this.getCostsByProvider(byModel);

    logger.log(
      "[AI_COSTS]:",
      `Computed for period=${period}, models=${byModel.length}, users=${topUsers.length}, sources=${bySource.length}`,
    );

    return {
      byModel,
      byProvider,
      topUsers,
      trend,
      balances,
      bySource,
      creditsBySource,
      comparison,
      trendBySource,
    };
  }

  /** Aggregate costs grouped by model. */
  static async getCostsByModel(startDate: Date): Promise<AICostByModel[]> {
    const groups = await prisma.openaiUsageLog.groupBy({
      by: ["model"],
      where: { createdAt: { gte: startDate } },
      _sum: { estimatedCost: true, promptTokens: true, completionTokens: true },
      _count: true,
    });

    return groups
      .map((g) => {
        const totalCost = g._sum?.estimatedCost ?? 0;
        const totalRequests = g._count;
        return {
          model: g.model,
          provider: MODEL_REGISTRY[g.model]?.provider ?? "unknown",
          totalCost: Math.round(totalCost * 1e6) / 1e6,
          totalRequests,
          totalPromptTokens: g._sum?.promptTokens ?? 0,
          totalCompletionTokens: g._sum?.completionTokens ?? 0,
          avgCostPerRequest:
            totalRequests > 0 ? Math.round((totalCost / totalRequests) * 1e6) / 1e6 : 0,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /** Aggregate byModel data into provider-level buckets. */
  static getCostsByProvider(byModel: AICostByModel[]): AICostByProvider[] {
    const providerMap = new Map<
      string,
      { totalCost: number; totalRequests: number; models: AICostByModel[] }
    >();

    for (const entry of byModel) {
      const existing = providerMap.get(entry.provider);
      if (existing) {
        existing.totalCost += entry.totalCost;
        existing.totalRequests += entry.totalRequests;
        existing.models.push(entry);
      } else {
        providerMap.set(entry.provider, {
          totalCost: entry.totalCost,
          totalRequests: entry.totalRequests,
          models: [entry],
        });
      }
    }

    return Array.from(providerMap.entries())
      .map(([provider, data]) => ({
        provider,
        totalCost: Math.round(data.totalCost * 1e6) / 1e6,
        totalRequests: data.totalRequests,
        models: data.models,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }

  /** Top users by total AI cost in the period. Bounded via CTE LIMIT. */
  static async getTopUsersByCost(startDate: Date, limit = 20): Promise<AICostTopUser[]> {
    // CTE limits to top N users first, then resolves top model per user.
    // Avoids unbounded groupBy([userId, model]) which returns users*models rows at scale.
    type RawRow = {
      user_id: string;
      total_cost: number;
      total_requests: bigint;
      top_model: string;
    };

    const rows = await prisma.$queryRaw<RawRow[]>`
      WITH top_users AS (
        SELECT user_id,
               SUM(estimated_cost)::float AS total_cost,
               COUNT(*)::bigint AS total_requests
        FROM openai_usage_log
        WHERE created_at >= ${startDate} AND user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY total_cost DESC
        LIMIT ${limit}
      ),
      user_top_model AS (
        SELECT DISTINCT ON (oul.user_id) oul.user_id, oul.model AS top_model
        FROM openai_usage_log oul
        JOIN top_users tu ON oul.user_id = tu.user_id
        WHERE oul.created_at >= ${startDate}
        GROUP BY oul.user_id, oul.model
        ORDER BY oul.user_id, SUM(oul.estimated_cost) DESC
      )
      SELECT tu.user_id, tu.total_cost, tu.total_requests, utm.top_model
      FROM top_users tu
      JOIN user_top_model utm ON tu.user_id = utm.user_id
      ORDER BY tu.total_cost DESC
    `;

    const userIds = rows.map((r) => r.user_id);
    if (userIds.length === 0) return [];

    const [users, limitsRows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
      prisma.userLimits.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, aiCreditsUsed: true },
      }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const limitsById = new Map(limitsRows.map((l) => [l.userId, l]));

    return rows.map((r) => {
      const user = usersById.get(r.user_id);
      const userLimits = limitsById.get(r.user_id);
      return {
        userId: r.user_id,
        email: user?.email ?? "unknown",
        firstName: user?.firstName ?? "",
        lastName: user?.lastName ?? "",
        totalCost: Math.round(r.total_cost * 1e6) / 1e6,
        totalRequests: Number(r.total_requests),
        aiCreditsUsed: userLimits?.aiCreditsUsed ?? 0,
        topModel: r.top_model,
      };
    });
  }

  /** Time-series cost trend aggregated by day or week. */
  static async getCostTrend(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<AICostTrendPoint[]> {
    type RawRow = { period: Date; cost: number; requests: bigint };

    const rows =
      granularity === "week"
        ? await prisma.$queryRaw<RawRow[]>`
            SELECT
              DATE_TRUNC('week', created_at) AS period,
              SUM(estimated_cost)::float AS cost,
              COUNT(*)::bigint AS requests
            FROM openai_usage_log
            WHERE created_at >= ${startDate}
            GROUP BY DATE_TRUNC('week', created_at)
            ORDER BY DATE_TRUNC('week', created_at) ASC
          `
        : await prisma.$queryRaw<RawRow[]>`
            SELECT
              DATE_TRUNC('day', created_at) AS period,
              SUM(estimated_cost)::float AS cost,
              COUNT(*)::bigint AS requests
            FROM openai_usage_log
            WHERE created_at >= ${startDate}
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY DATE_TRUNC('day', created_at) ASC
          `;

    return rows.map((r) => ({
      date: r.period.toISOString().split("T")[0],
      cost: Math.round(r.cost * 1e6) / 1e6,
      requests: Number(r.requests),
    }));
  }

  /** Aggregate costs grouped by source (content_generation, agent_chat, etc.). */
  static async getCostsBySource(startDate: Date): Promise<AICostBySource[]> {
    type RawRow = { source: string; total_cost: number; total_requests: bigint };

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        COALESCE(source, 'unknown') AS source,
        SUM(estimated_cost)::float AS total_cost,
        COUNT(*)::bigint AS total_requests
      FROM openai_usage_log
      WHERE created_at >= ${startDate}
      GROUP BY COALESCE(source, 'unknown')
      ORDER BY total_cost DESC
    `;

    return rows.map((r) => {
      const totalCost = Math.round(r.total_cost * 1e6) / 1e6;
      const totalRequests = Number(r.total_requests);
      return {
        source: r.source,
        totalCost,
        totalRequests,
        avgCostPerRequest:
          totalRequests > 0 ? Math.round((totalCost / totalRequests) * 1e6) / 1e6 : 0,
      };
    });
  }

  /** Aggregate credits usage grouped by action (from usage_records metadata). */
  static async getCreditsBySource(startDate: Date): Promise<CreditsBySource[]> {
    type RawRow = { source: string; total_credits: number; total_records: bigint };

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        COALESCE(metadata->>'action', 'unknown') AS source,
        SUM(quantity)::float AS total_credits,
        COUNT(*)::bigint AS total_records
      FROM usage_records
      WHERE created_at >= ${startDate}
        AND resource_type = 'ai_credits'
      GROUP BY COALESCE(metadata->>'action', 'unknown')
      ORDER BY total_credits DESC
    `;

    return rows.map((r) => ({
      source: r.source,
      totalCredits: Math.round(r.total_credits * 100) / 100,
      totalRecords: Number(r.total_records),
    }));
  }

  /** Compare current period vs previous period of same length. */
  static async getPeriodComparison(periodDays: number): Promise<PeriodComparison> {
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - periodDays);
    currentStart.setHours(0, 0, 0, 0);

    const previousStart = new Date(currentStart);
    previousStart.setDate(previousStart.getDate() - periodDays);

    type RawRow = { total_cost: number; total_requests: bigint };
    type CreditsRow = { total_credits: number };

    const [currentCosts, previousCosts, currentCredits, previousCredits] = await Promise.all([
      prisma.$queryRaw<RawRow[]>`
        SELECT COALESCE(SUM(estimated_cost), 0)::float AS total_cost, COUNT(*)::bigint AS total_requests
        FROM openai_usage_log WHERE created_at >= ${currentStart}
      `,
      prisma.$queryRaw<RawRow[]>`
        SELECT COALESCE(SUM(estimated_cost), 0)::float AS total_cost, COUNT(*)::bigint AS total_requests
        FROM openai_usage_log WHERE created_at >= ${previousStart} AND created_at < ${currentStart}
      `,
      prisma.$queryRaw<CreditsRow[]>`
        SELECT COALESCE(SUM(quantity), 0)::float AS total_credits
        FROM usage_records WHERE created_at >= ${currentStart} AND resource_type = 'ai_credits'
      `,
      prisma.$queryRaw<CreditsRow[]>`
        SELECT COALESCE(SUM(quantity), 0)::float AS total_credits
        FROM usage_records WHERE created_at >= ${previousStart} AND created_at < ${currentStart} AND resource_type = 'ai_credits'
      `,
    ]);

    const curCost = currentCosts[0]?.total_cost ?? 0;
    const prevCost = previousCosts[0]?.total_cost ?? 0;
    const curReqs = Number(currentCosts[0]?.total_requests ?? 0n);
    const prevReqs = Number(previousCosts[0]?.total_requests ?? 0n);
    const curCreds = currentCredits[0]?.total_credits ?? 0;
    const prevCreds = previousCredits[0]?.total_credits ?? 0;

    const pctChange = (current: number, previous: number): number =>
      previous === 0
        ? current > 0
          ? 100
          : 0
        : Math.round(((current - previous) / previous) * 10000) / 100;

    return {
      currentCost: Math.round(curCost * 1e6) / 1e6,
      previousCost: Math.round(prevCost * 1e6) / 1e6,
      costChangePercent: pctChange(curCost, prevCost),
      currentCredits: Math.round(curCreds * 100) / 100,
      previousCredits: Math.round(prevCreds * 100) / 100,
      creditsChangePercent: pctChange(curCreds, prevCreds),
      currentRequests: curReqs,
      previousRequests: prevReqs,
      requestsChangePercent: pctChange(curReqs, prevReqs),
    };
  }

  /** Time-series cost trend broken down by source, for stacked area chart. */
  static async getCostTrendBySource(
    startDate: Date,
    granularity: "day" | "week",
  ): Promise<AICostTrendBySourcePoint[]> {
    type RawRow = { period: Date; source: string; cost: number };

    const rows =
      granularity === "week"
        ? await prisma.$queryRaw<RawRow[]>`
            SELECT
              DATE_TRUNC('week', created_at) AS period,
              COALESCE(source, 'unknown') AS source,
              SUM(estimated_cost)::float AS cost
            FROM openai_usage_log
            WHERE created_at >= ${startDate}
            GROUP BY DATE_TRUNC('week', created_at), COALESCE(source, 'unknown')
            ORDER BY period ASC
          `
        : await prisma.$queryRaw<RawRow[]>`
            SELECT
              DATE_TRUNC('day', created_at) AS period,
              COALESCE(source, 'unknown') AS source,
              SUM(estimated_cost)::float AS cost
            FROM openai_usage_log
            WHERE created_at >= ${startDate}
            GROUP BY DATE_TRUNC('day', created_at), COALESCE(source, 'unknown')
            ORDER BY period ASC
          `;

    // Group rows by date, then pivot sources into a Record
    const dateMap = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const date = r.period.toISOString().split("T")[0];
      const existing = dateMap.get(date) ?? {};
      existing[r.source] = Math.round(r.cost * 1e6) / 1e6;
      dateMap.set(date, existing);
    }

    return Array.from(dateMap.entries()).map(([date, sources]) => ({ date, sources }));
  }

  /** Fetch provider account balances where API is available. */
  static async getProviderBalances(): Promise<ProviderBalance[]> {
    const balances: ProviderBalance[] = [];

    // Moonshot exposes a balance endpoint
    balances.push(await this.fetchMoonshotBalance());

    // Other providers have no public balance API
    for (const provider of ["openai", "anthropic", "google", "deepseek", "xai"] as const) {
      balances.push({ provider, available: false });
    }

    return balances;
  }

  private static async fetchMoonshotBalance(): Promise<ProviderBalance> {
    const apiKey = process.env.MOONSHOT_API_KEY;
    if (!apiKey) {
      return { provider: "moonshot", available: false, error: "API key not configured" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch("https://api.moonshot.cn/v1/users/balance", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });

      if (!response.ok) {
        return { provider: "moonshot", available: false, error: "Balance fetch failed" };
      }

      const body = (await response.json()) as {
        data?: { available_balance?: number; currency?: string };
      };

      return {
        provider: "moonshot",
        available: true,
        balance: body.data?.available_balance ?? 0,
        currency: body.data?.currency ?? "CNY",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[AI_COSTS]:", `Moonshot balance fetch failed: ${message}`);
      return { provider: "moonshot", available: false, error: "Balance fetch failed" };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
