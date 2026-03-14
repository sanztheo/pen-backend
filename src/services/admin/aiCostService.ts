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
  AICostTopUser,
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

const AICostsResponseSchema = z.object({
  byModel: z.array(AICostByModelSchema),
  byProvider: z.array(AICostByProviderSchema),
  topUsers: z.array(AICostTopUserSchema),
  trend: z.array(AICostTrendPointSchema),
  balances: z.array(ProviderBalanceSchema),
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

    const byModel = await this.getCostsByModel(startDate);
    const [byProvider, topUsers, trend, balances] = await Promise.all([
      this.getCostsByProvider(byModel),
      this.getTopUsersByCost(startDate),
      this.getCostTrend(startDate, granularity),
      this.getProviderBalances(),
    ]);

    logger.log(
      "[AI_COSTS]:",
      `Computed for period=${period}, models=${byModel.length}, users=${topUsers.length}`,
    );

    return { byModel, byProvider, topUsers, trend, balances };
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
  static async getCostsByProvider(byModel: AICostByModel[]): Promise<AICostByProvider[]> {
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

  /** Top users by total AI cost in the period. */
  static async getTopUsersByCost(startDate: Date, limit = 20): Promise<AICostTopUser[]> {
    // Group by userId + model to find each user's top model
    const groups = await prisma.openaiUsageLog.groupBy({
      by: ["userId", "model"],
      where: {
        createdAt: { gte: startDate },
        userId: { not: null },
      },
      _sum: { estimatedCost: true },
      _count: true,
    });

    // Aggregate per user, tracking top model
    const userMap = new Map<
      string,
      { totalCost: number; totalRequests: number; topModel: string; topModelCost: number }
    >();

    for (const g of groups) {
      const uid = g.userId as string;
      const cost = g._sum?.estimatedCost ?? 0;
      const requests = g._count;
      const existing = userMap.get(uid);

      if (existing) {
        existing.totalCost += cost;
        existing.totalRequests += requests;
        if (cost > existing.topModelCost) {
          existing.topModel = g.model;
          existing.topModelCost = cost;
        }
      } else {
        userMap.set(uid, {
          totalCost: cost,
          totalRequests: requests,
          topModel: g.model,
          topModelCost: cost,
        });
      }
    }

    // Sort by cost and take top N
    const sorted = Array.from(userMap.entries())
      .sort((a, b) => b[1].totalCost - a[1].totalCost)
      .slice(0, limit);

    const userIds = sorted.map(([uid]) => uid);

    // Batch: 2 queries instead of 40 (N+1 fix)
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

    return sorted.map(([userId, data]) => {
      const user = usersById.get(userId);
      const userLimits = limitsById.get(userId);
      return {
        userId,
        email: user?.email ?? "unknown",
        firstName: user?.firstName ?? "",
        lastName: user?.lastName ?? "",
        totalCost: Math.round(data.totalCost * 1e6) / 1e6,
        totalRequests: data.totalRequests,
        aiCreditsUsed: userLimits?.aiCreditsUsed ?? 0,
        topModel: data.topModel,
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
