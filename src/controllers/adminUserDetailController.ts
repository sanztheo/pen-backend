/**
 * Admin User Detail Controller
 * Handles admin endpoints for viewing individual user data:
 * conversations, quizzes, pages, and AI usage.
 *
 * Heavy handlers extracted to sub-controllers to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { cacheBlockNoteContent } from "../lib/redis.js";
import { parsePagination, validateUserId, validateParam } from "../utils/adminHelpers.js";
import { getUserConversationDetail } from "./adminUserConversationController.js";
import { getUserAIUsage } from "./adminUserAIUsageController.js";

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

  // Delegated to adminUserConversationController.ts
  static getUserConversationDetail = getUserConversationDetail;

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

  // Delegated to adminUserAIUsageController.ts
  static getUserAIUsage = getUserAIUsage;
}
