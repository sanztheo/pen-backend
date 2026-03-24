/**
 * Admin User Conversation Controller
 * Extracted from adminUserDetailController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { validateUserId, validateParam } from "../utils/adminHelpers.js";

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

/**
 * GET /api/admin/users/:userId/conversations/:conversationId
 */
export async function getUserConversationDetail(req: Request, res: Response): Promise<void> {
  try {
    const { userId, conversationId } = req.params;
    if (!validateUserId(userId, res)) return;
    if (!validateParam(conversationId, "conversationId", res)) return;

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const rawLimit = Number(req.query.limit) || DEFAULT_MESSAGE_LIMIT;
    const limit = Math.min(Math.max(rawLimit, 1), MAX_MESSAGE_LIMIT);

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
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

    const hasMore = conversation.messages.length > limit;
    const messages = hasMore ? conversation.messages.slice(0, limit) : conversation.messages;
    const nextCursor = hasMore ? (messages[messages.length - 1]?.id ?? null) : null;

    logger.log("[ADMIN_USER_DETAIL] getUserConversationDetail", {
      adminId: req.user!.id,
      targetUserId: userId,
      action: "admin.user.conversation.detail",
      resourceId: conversationId,
    });

    res.status(200).json({
      success: true,
      data: {
        conversation: { ...conversation, messages },
        nextCursor,
      },
    });
  } catch (error: unknown) {
    logger.error("[ADMIN_USER_DETAIL] getUserConversationDetail error:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de la conversation",
    });
  }
}
