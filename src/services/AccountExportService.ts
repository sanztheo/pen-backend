import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

import type { UserExportData } from "./AccountDeletionService.types.js";

// ─── Constants ───────────────────────────────────────────
const EXPORT_MAX_ITEMS = 5_000;

/**
 * Handles GDPR data export (right to data portability).
 * Separated from AccountDeletionService to keep files under 300 lines.
 */
export class AccountExportService {
  static async exportUserData(userId: string): Promise<UserExportData> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new Error(`[ACCOUNT_EXPORT] User not found: ${userId}`);
    }

    const [profile, workspaces, pages, quizzes, conversations, activityLogs, subscription] =
      await Promise.all([
        AccountExportService.fetchProfile(userId),
        AccountExportService.fetchWorkspaces(userId),
        AccountExportService.fetchPages(userId),
        AccountExportService.fetchQuizzes(userId),
        AccountExportService.fetchConversations(userId),
        AccountExportService.fetchActivityLogs(userId),
        AccountExportService.fetchSubscription(userId),
      ]);

    const truncated =
      pages.length >= EXPORT_MAX_ITEMS ||
      activityLogs.length >= EXPORT_MAX_ITEMS ||
      conversations.length >= EXPORT_MAX_ITEMS;

    logger.log(`[ACCOUNT_EXPORT] Exported data for user ${userId} (truncated: ${truncated})`);

    return {
      profile,
      workspaces,
      pages,
      quizzes,
      conversations,
      activityLogs,
      subscription,
      truncated,
    };
  }

  // ─── Private: Export helpers ─────────────────────────────

  private static async fetchProfile(userId: string): Promise<UserExportData["profile"]> {
    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
        betaStatus: true,
        betaJoinedAt: true,
        onboardingCompleted: true,
        settings: true,
      },
    });
  }

  private static async fetchWorkspaces(userId: string): Promise<UserExportData["workspaces"]> {
    return prisma.workspace.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        createdAt: true,
        isArchived: true,
        members: {
          select: {
            userId: true,
            role: true,
            joinedAt: true,
          },
        },
      },
    });
  }

  private static async fetchPages(userId: string): Promise<UserExportData["pages"]> {
    return prisma.page.findMany({
      where: { createdBy: userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        workspaceId: true,
        projectId: true,
        blockNoteContent: true,
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchQuizzes(userId: string): Promise<UserExportData["quizzes"]> {
    return prisma.quiz.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        isCompleted: true,
        completedAt: true,
        questions: true,
        userAnswers: true,
      },
    });
  }

  private static async fetchConversations(
    userId: string,
  ): Promise<UserExportData["conversations"]> {
    return prisma.aIConversation.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        messageCount: true,
        messages: {
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchActivityLogs(userId: string): Promise<UserExportData["activityLogs"]> {
    return prisma.activityLog.findMany({
      where: { userId },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        details: true,
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ITEMS,
    });
  }

  private static async fetchSubscription(userId: string): Promise<UserExportData["subscription"]> {
    return prisma.userSubscription.findUnique({
      where: { userId },
      select: {
        plan: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });
  }
}
