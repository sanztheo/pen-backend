/**
 * Chat-specific helpers
 *
 * Extracted from the POST /chat handler to keep chat.ts under 300 lines.
 */

import { logger } from "../../utils/logger.js";
import type { Request, Response } from "express";
import type { AgentMode } from "../../services/agent/index.js";
import {
  saveConversation,
  updateConversationStatus,
  updateActiveStreamId,
} from "../../services/agent/conversationService.js";
import { AIQuotaManager } from "../../services/ai/quotaManager.js";
import type { UIMessage } from "ai";
import { AICreditsService } from "../../services/credits/aiCreditsService.js";
import { MODELS } from "../../config/models.js";
import { addMemories } from "../../services/mem0/mem0Client.js";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../services/authzService.js";

interface ChatSelection {
  text: string;
  pageId?: string;
  blockIds?: string[];
}

/**
 * Resolve selection context against the user's workspace.
 *
 * REQUIRES: req.workspaceId set by verifyWorkspaceAccess middleware (callers
 * pass it explicitly — see chat.ts which reads it from req.body after the
 * middleware has validated workspace membership).
 *
 * If `pageId` does not belong to `workspaceId`, drops it silently (so probing
 * for arbitrary page ids cannot distinguish "exists elsewhere" vs "missing").
 * If `workspaceId` is missing/empty, throws 403 — explicit guard against
 * future refactors that reuse this helper without the middleware in front.
 */
export async function resolveSelectionContext(
  req: Request,
  workspaceId: string | undefined,
  selection: ChatSelection | undefined,
): Promise<ChatSelection | undefined> {
  if (!selection) return undefined;
  if (!selection.pageId) return selection;

  // Explicit guard: silent-drop pattern (findFirst → null) hides the case
  // where the workspace context never made it onto `req`.
  if (!workspaceId) {
    throw new HttpError(403, "WORKSPACE_CONTEXT_MISSING");
  }

  const ownedPage = await prisma.page.findFirst({
    where: { id: selection.pageId, workspaceId, isArchived: false },
    select: { id: true },
  });
  if (!ownedPage) {
    logger.warn("[AGENT-CHAT] selection.pageId dropped — not in workspace", {
      pageId: selection.pageId,
      workspaceId,
      userId: req.user?.id,
    });
    const { pageId: _droppedPageId, ...rest } = selection;
    return rest;
  }
  return selection;
}

interface OnFinishContext {
  conversationId: string | undefined;
  userId: string;
  workspaceId: string;
  mode: AgentMode;
  agentId: string | undefined;
  agentType: string | undefined;
  estimatedTokens: number;
  lastUserMessage: string;
  aiAction: string | undefined;
  /** Model selector — composite ID (e.g. "gemini-3-flash-preview:high") */
  modelSelection: string | undefined;
  /** Model selector — resolved model ID */
  modelId: string | undefined;
  /** Model selector — resolved thinking level */
  thinkingLevel: string | undefined;
}

/** Build the onFinish callback for pipeUIMessageStreamToResponse */
export function buildOnFinish(ctx: OnFinishContext) {
  return async ({ messages: allMessages }: { messages: UIMessage[] }) => {
    logger.log(`💾 [AGENT-CHAT] onFinish - Sauvegarde de ${allMessages.length} messages`);
    if (ctx.conversationId) {
      // Build extra metadata for model selection traceability
      const extraMetadata: Record<string, unknown> = {};
      if (ctx.modelSelection) {
        extraMetadata.modelSelection = ctx.modelSelection;
        extraMetadata.modelId = ctx.modelId;
        extraMetadata.thinkingLevel = ctx.thinkingLevel;
      }

      await saveConversation({
        conversationId: ctx.conversationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        messages: allMessages,
        mode: ctx.mode,
        status: "COMPLETED",
        agentId: ctx.agentId,
        agentType: ctx.agentType,
        extraMetadata,
      });
      await updateActiveStreamId(ctx.conversationId, null, ctx.userId);
    }

    // 📊 Enregistrer l'usage des tokens pour le quota par utilisateur
    try {
      const outputTokens = Math.ceil(JSON.stringify(allMessages).length / 4);

      await AIQuotaManager.recordUsage(
        MODELS.AGENT_THINKING,
        ctx.estimatedTokens,
        outputTokens,
        ctx.userId,
        ctx.userId,
        ctx.aiAction,
      );
      logger.log(
        `📊 [QUOTA] Usage enregistré pour ${ctx.userId}: ~${ctx.estimatedTokens + outputTokens} tokens`,
      );
    } catch (quotaError) {
      logger.error("⚠️ [QUOTA] Erreur enregistrement usage:", quotaError);
    }

    // 🧠 Mem0: stocker la conversation pour enrichir la mémoire (fire-and-forget)
    const lastAssistantMsg = allMessages.filter((m: UIMessage) => m.role === "assistant").pop();
    if (ctx.lastUserMessage && lastAssistantMsg) {
      const assistantText = lastAssistantMsg.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (assistantText) {
        addMemories(ctx.userId, [
          { role: "user", content: ctx.lastUserMessage.slice(0, 2000) },
          { role: "assistant", content: assistantText.slice(0, 2000) },
        ]).catch((err: unknown) => logger.warn("[MEM0] Uncaught add error:", err));
      }
    }
  };
}

/** Handle POST /chat errors: mark conversation as errored, refund credits */
export function handleChatError(error: unknown, req: Request, res: Response): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error("❌ [AGENT-CHAT] Erreur:", error);

  const failedConvId = req.body?.conversationId;
  const failedUserId = req.user?.id;
  if (failedConvId && failedUserId) {
    updateConversationStatus(failedConvId, "ERROR", failedUserId).catch(() => {});
    updateActiveStreamId(failedConvId, null, failedUserId).catch(() => {});
  }

  const creditsCost = req.aiCredits?.cost;
  const refundUserId = req.user?.id;
  if (creditsCost && refundUserId) {
    AICreditsService.refundCredits(refundUserId, creditsCost, "agent_chat_error").catch(
      (err: unknown) => logger.error("[REFUND] Erreur refund agent/chat:", err),
    );
  }

  // Map structured HttpError (e.g. resolveSelectionContext 403) to its real
  // status instead of swallowing it under a generic 500.
  if (error instanceof HttpError) {
    if (!res.headersSent) {
      res.status(error.status).json({ error: error.message });
    }
    return;
  }

  if (!res.headersSent) {
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors de l'exécution de l'agent"
        : errorMessage || "Erreur lors de l'exécution de l'agent";
    res.status(500).json({
      error: "AGENT_ERROR",
      message: safeMessage,
    });
  }
}
