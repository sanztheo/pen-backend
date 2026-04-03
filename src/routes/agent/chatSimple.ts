/**
 * Agent Chat Simple Route
 *
 * POST /chat/simple — Version non-streaming (JSON)
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { requireAICredits } from "../../middlewares/requireAICredits.js";
import { detectIntent, extractLastUserMessage } from "../../services/agent/index.js";
import { convertToModelMessages } from "ai";
import type { UIMessage } from "ai";
import { AICreditsService } from "../../services/credits/aiCreditsService.js";
import { verifyWorkspaceAccess } from "../../middlewares/workspaceAccess.js";
import { searchMemories } from "../../services/mem0/mem0Client.js";
import { aiConcurrencyLimit } from "../../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../../middlewares/dailyTokenQuota.js";

import { calculateDynamicCost, isAgentMode } from "./helpers.js";

export const chatSimpleRouter = Router();

/**
 * POST /api/agent/chat/simple
 *
 * Version non-streaming pour les tests ou les cas simples.
 * Retourne la réponse complète en JSON.
 */
chatSimpleRouter.post(
  "/chat/simple",
  aiConcurrencyLimit,
  dailyTokenQuota,
  verifyWorkspaceAccess,
  requireAICredits({
    dynamicCost: calculateDynamicCost,
    action: "agent_chat_simple",
  }),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      const {
        messages,
        mode = "fast",
        workspaceId,
        useWeb = false,
        ragSources,
        conversationHistory,
        personalization,
      } = req.body;

      // Validation
      if (!messages || !Array.isArray(messages) || !workspaceId) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "messages et workspaceId sont requis",
        });
      }

      if (!isAgentMode(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Mode invalide. Valeurs acceptées: "fast", "deep"',
        });
      }

      // Auto-detect intent
      const simpleLastMsg = extractLastUserMessage(messages);
      const simpleIntent = detectIntent(simpleLastMsg);

      logger.log(`🤖 [AGENT-SIMPLE] Requête:`, {
        userId,
        workspaceId,
        mode,
        intent: simpleIntent,
        messagesCount: messages.length,
      });

      // Import dynamique pour éviter les problèmes de compilation
      const { runPennoteAgentSimple } = await import("../../services/agent/index.js");

      // Convertir UIMessage[] vers ModelMessage[]
      const modelMessages = await convertToModelMessages(messages as UIMessage[]);

      // 🧠 Mem0: récupérer les souvenirs pertinents
      const simpleMemories = await searchMemories(userId, simpleLastMsg);
      const simpleMemoryContext = simpleMemories.map((m) => m.memory);

      const result = await runPennoteAgentSimple({
        messages: modelMessages,
        mode,
        intent: simpleIntent,
        userId,
        workspaceId,
        useWeb,
        ragSources,
        conversationHistory,
        personalization,
        memoryContext: simpleMemoryContext,
      });

      res.json({
        success: true,
        text: result.text,
        toolCalls: result.toolCalls,
        usage: result.usage,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("❌ [AGENT-SIMPLE] Erreur:", error);

      const creditsCost = req.aiCredits?.cost;
      const refundUserId = req.user?.id;
      if (creditsCost && refundUserId) {
        AICreditsService.refundCredits(refundUserId, creditsCost, "agent_simple_error").catch(
          (err: unknown) => logger.error("[REFUND] Erreur refund agent/simple:", err),
        );
      }

      const safeMessage =
        process.env.NODE_ENV === "production"
          ? "Erreur lors de l'exécution de l'agent"
          : errorMessage || "Erreur lors de l'exécution de l'agent";
      res.status(500).json({
        error: "AGENT_ERROR",
        message: safeMessage,
      });
    }
  },
);
