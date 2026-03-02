import { prisma } from "../lib/prisma.js";
import {
  EXPORT_MAX_ITEMS,
  DELETION_LOG_PREFIX,
  type UserExportData,
} from "./AccountDeletionService.types.js";

export class AccountExportService {
  /**
   * Exports all user data for GDPR compliance.
   * Paginated with max 1000 items per entity type.
   */
  static async exportUserData(userId: string): Promise<UserExportData> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        lastLoginAt: true,
        settings: true,
      },
    });

    if (!user) {
      throw new Error(`${DELETION_LOG_PREFIX} User not found for export: ${userId}`);
    }

    const [pages, projects, quizzes, conversations, activityLogs, subscription] = await Promise.all(
      [
        prisma.page.findMany({
          where: { createdBy: userId },
          take: EXPORT_MAX_ITEMS,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            workspaceId: true,
            projectId: true,
          },
        }),
        prisma.project.findMany({
          where: { createdBy: userId },
          take: EXPORT_MAX_ITEMS,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            workspaceId: true,
          },
        }),
        prisma.quiz.findMany({
          where: { userId },
          take: EXPORT_MAX_ITEMS,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            isCompleted: true,
            createdAt: true,
            completedAt: true,
          },
        }),
        prisma.aIConversation.findMany({
          where: { userId },
          take: EXPORT_MAX_ITEMS,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            messageCount: true,
            createdAt: true,
            lastMessageAt: true,
          },
        }),
        prisma.activityLog.findMany({
          where: { userId },
          take: EXPORT_MAX_ITEMS,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            action: true,
            entityType: true,
            createdAt: true,
          },
        }),
        prisma.userSubscription.findUnique({
          where: { userId },
          select: {
            plan: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
          },
        }),
      ],
    );

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        settings: user.settings,
      },
      pages: pages.map((p) => ({
        id: p.id,
        title: p.title,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        workspaceId: p.workspaceId,
        projectId: p.projectId,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
        workspaceId: p.workspaceId,
      })),
      quizzes: quizzes.map((q) => ({
        id: q.id,
        title: q.title,
        isCompleted: q.isCompleted,
        createdAt: q.createdAt.toISOString(),
        completedAt: q.completedAt?.toISOString() ?? null,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c.messageCount,
        createdAt: c.createdAt.toISOString(),
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      })),
      activityLogs: activityLogs.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        createdAt: a.createdAt.toISOString(),
      })),
      subscription: subscription
        ? {
            plan: subscription.plan,
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
    };
  }
}
