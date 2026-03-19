/**
 * Admin User Detail Controller
 * Handles admin endpoints for viewing individual user data:
 * conversations, quizzes, pages, and AI usage.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { cacheBlockNoteContent } from "../lib/redis.js";
import { parsePagination, validateUserId, validateParam } from "../utils/adminHelpers.js";

// ─── Controller ──────────────────────────────────────────────

export class AdminUserDetailController {
  /**
   * GET /api/admin/users/:userId/conversations
   */
  static async getUserConversations(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!validateUserId(userId, res)) return;

      const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });

      const [conversations, total] = await Promise.all([
        prisma.aIConversation.findMany({
          where: { userId },
          select: {
            id: true,
            title: true,
            status: true,
            messageCount: true,
            lastMessageAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.aIConversation.count({ where: { userId } }),
      ]);

      logger.log("[ADMIN_USER_DETAIL] getUserConversations", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.conversations.list",
        resultCount: conversations.length,
      });

      res.status(200).json({
        success: true,
        data: { conversations, total, page, totalPages: Math.ceil(total / limit) },
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER_DETAIL] getUserConversations error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des conversations",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/conversations/:conversationId
   */
  static async getUserConversationDetail(req: Request, res: Response): Promise<void> {
    try {
      const { userId, conversationId } = req.params;
      if (!validateUserId(userId, res)) return;
      if (!validateParam(conversationId, "conversationId", res)) return;

      const conversation = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId },
        select: {
          id: true,
          title: true,
          status: true,
          messageCount: true,
          messages: {
            select: {
              id: true,
              role: true,
              content: true,
              mode: true,
              createdAt: true,
              toolCalls: true,
              pageCreationData: true,
              pageId: true,
              pageTitle: true,
            },
            orderBy: { createdAt: "asc" },
            take: 500,
          },
        },
      });

      if (!conversation) {
        res.status(404).json({
          success: false,
          error: "Conversation non trouvée pour cet utilisateur",
        });
        return;
      }

      logger.log("[ADMIN_USER_DETAIL] getUserConversationDetail", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.conversation.detail",
        resourceId: conversationId,
      });

      res.status(200).json({ success: true, data: { conversation } });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER_DETAIL] getUserConversationDetail error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération de la conversation",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/quizzes
   */
  static async getUserQuizzes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!validateUserId(userId, res)) return;

      const { page, limit, skip } = parsePagination(req.query as { page?: string; limit?: string });

      const [quizzes, total] = await Promise.all([
        prisma.quiz.findMany({
          where: { userId },
          select: {
            id: true,
            title: true,
            isCompleted: true,
            schoolLevel: true,
            timeSpent: true,
            completedAt: true,
            createdAt: true,
            result: {
              select: {
                percentage: true,
                adaptedGrade: true,
                gradeScale: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.quiz.count({ where: { userId } }),
      ]);

      logger.log("[ADMIN_USER_DETAIL] getUserQuizzes", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.quizzes.list",
        resultCount: quizzes.length,
      });

      res.status(200).json({
        success: true,
        data: {
          quizzes: quizzes.map((q) => ({ ...q, result: q.result ?? null })),
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER_DETAIL] getUserQuizzes error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des quizzes",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/quizzes/:quizId
   */
  static async getUserQuizDetail(req: Request, res: Response): Promise<void> {
    try {
      const { userId, quizId } = req.params;
      if (!validateUserId(userId, res)) return;
      if (!validateParam(quizId, "quizId", res)) return;

      const quiz = await prisma.quiz.findFirst({
        where: { id: quizId, userId },
        select: {
          id: true,
          title: true,
          questions: true,
          userAnswers: true,
          timeSpent: true,
          schoolLevel: true,
          isCompleted: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          result: {
            select: {
              id: true,
              percentage: true,
              adaptedGrade: true,
              gradeScale: true,
              totalScore: true,
              maxScore: true,
              detailedScoring: true,
              recommendations: true,
              strengths: true,
              weaknesses: true,
              timeAnalysis: true,
              createdAt: true,
            },
          },
        },
      });

      if (!quiz) {
        res.status(404).json({
          success: false,
          error: "Quiz non trouvé pour cet utilisateur",
        });
        return;
      }

      logger.log("[ADMIN_USER_DETAIL] getUserQuizDetail", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.quiz.detail",
        resourceId: quizId,
      });

      res.status(200).json({
        success: true,
        data: { ...quiz, result: quiz.result ?? null },
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER_DETAIL] getUserQuizDetail error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du quiz",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/pages/:pageId/content
   */
  static async getUserPageContent(req: Request, res: Response): Promise<void> {
    try {
      const { userId, pageId } = req.params;
      if (!validateUserId(userId, res)) return;
      if (!validateParam(pageId, "pageId", res)) return;

      const pageMeta = await prisma.page.findFirst({
        where: { id: pageId, createdBy: userId },
        select: {
          id: true,
          title: true,
          icon: true,
          iconColor: true,
          createdAt: true,
          updatedAt: true,
          workspace: { select: { name: true } },
        },
      });

      if (!pageMeta) {
        res.status(404).json({
          success: false,
          error: "Page non trouvée pour cet utilisateur",
        });
        return;
      }

      const cached = await cacheBlockNoteContent(pageId);
      const content = cached?.blockNoteContent ?? null;

      logger.log("[ADMIN_USER_DETAIL] getUserPageContent", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.page.content",
        resourceId: pageId,
      });

      res.status(200).json({
        success: true,
        data: {
          page: {
            id: pageMeta.id,
            title: pageMeta.title,
            icon: pageMeta.icon,
            iconColor: pageMeta.iconColor,
            content,
            createdAt: pageMeta.createdAt,
            updatedAt: pageMeta.updatedAt,
            workspaceName: pageMeta.workspace.name,
          },
        },
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER_DETAIL] getUserPageContent error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du contenu de la page",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/ai-usage?period=30d
   */
  static async getUserAIUsage(req: Request, res: Response): Promise<void> {
    const VALID_PERIODS: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
    };
    const MAX_PARAM_LENGTH = 10;

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
}
