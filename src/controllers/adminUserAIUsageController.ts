/**
 * Admin User AI Usage Controller
 * Extracted from adminUserDetailController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { validateUserId } from "../utils/adminHelpers.js";

const VALID_PERIODS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};
const MAX_PARAM_LENGTH = 10;

/**
 * GET /api/admin/users/:userId/ai-usage?period=30d
 */
export async function getUserAIUsage(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    if (!validateUserId(userId, res)) return;

    const periodParam = typeof req.query.period === "string" ? req.query.period : "30d";
    if (periodParam.length > MAX_PARAM_LENGTH || !VALID_PERIODS[periodParam]) {
      res.status(400).json({
        success: false,
        error: "Période invalide. Valeurs acceptées : 7d, 30d, 90d",
      });
      return;
    }

    const days = VALID_PERIODS[periodParam];
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const [aggregateBySource, dailyTrend] = await Promise.all([
      prisma.openaiUsageLog.groupBy({
        by: ["source"],
        where: { userId, createdAt: { gte: sinceDate } },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          estimatedCost: true,
        },
        _count: true,
      }),
      prisma.$queryRaw<
        Array<{
          date: string;
          prompt_tokens: bigint;
          completion_tokens: bigint;
          cost: number;
        }>
      >`
        SELECT
          DATE("created_at") AS date,
          SUM("prompt_tokens")::bigint AS prompt_tokens,
          SUM("completion_tokens")::bigint AS completion_tokens,
          SUM("estimated_cost")::double precision AS cost
        FROM "openai_usage_log"
        WHERE "user_id" = ${userId}
          AND "created_at" >= ${sinceDate}
        GROUP BY DATE("created_at")
        ORDER BY date ASC
      `,
    ]);

    const bySource = aggregateBySource.map((row) => ({
      source: row.source ?? "unknown",
      promptTokens: row._sum.promptTokens ?? 0,
      completionTokens: row._sum.completionTokens ?? 0,
      cost: row._sum.estimatedCost ?? 0,
      count: row._count,
    }));

    const totalPromptTokens = bySource.reduce((acc, s) => acc + s.promptTokens, 0);
    const totalCompletionTokens = bySource.reduce((acc, s) => acc + s.completionTokens, 0);
    const totalCost = bySource.reduce((acc, s) => acc + s.cost, 0);

    const daily = dailyTrend.map((row) => ({
      date: String(row.date),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      cost: row.cost ?? 0,
    }));

    logger.log("[ADMIN_USER_DETAIL] getUserAIUsage", {
      adminId: req.user!.id,
      targetUserId: userId,
      action: "admin.user.ai-usage",
      period: periodParam,
      sourceCount: bySource.length,
    });

    res.status(200).json({
      success: true,
      data: { totalPromptTokens, totalCompletionTokens, totalCost, bySource, daily },
    });
  } catch (error: unknown) {
    logger.error("[ADMIN_USER_DETAIL] getUserAIUsage error:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de l'utilisation AI",
    });
  }
}
