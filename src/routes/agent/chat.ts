/**
 * Agent Chat Route
 *
 * POST /chat — Streaming principal (SSE, compatible useChat)
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { requireAICredits } from "../../middlewares/requireAICredits.js";
import {
  runPennoteAgent,
  detectIntent,
  extractLastUserMessage,
} from "../../services/agent/index.js";
import { saveConversation } from "../../services/agent/conversationService.js";
import { getStreamContext } from "../../services/agent/resumableStreamService.js";
import { prisma } from "../../lib/prisma.js";
import { AIQuotaManager } from "../../services/ai/quotaManager.js";
import { convertToModelMessages, generateId } from "ai";
import type { UIMessage } from "ai";
import { verifyWorkspaceAccess } from "../../middlewares/workspaceAccess.js";
import { MODELS } from "../../config/models.js";
import { searchMemories } from "../../services/mem0/mem0Client.js";
import { getPresetAgent } from "../../services/agent/presetAgents.js";
import { aiConcurrencyLimit } from "../../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../../middlewares/dailyTokenQuota.js";
import { updateActiveStreamId } from "../../services/agent/conversationService.js";

import {
  calculateDynamicCost,
  estimateOutputTokens,
  isAgentMode,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_COUNT,
} from "./helpers.js";
import { buildOnFinish, handleChatError } from "./chatHelpers.js";

export const chatRouter = Router();

chatRouter.post(
  "/chat",
  aiConcurrencyLimit,
  dailyTokenQuota,
  verifyWorkspaceAccess,
  requireAICredits({ dynamicCost: calculateDynamicCost, action: "agent_chat" }),
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
        conversationId,
        useWeb = false,
        ragSources,
        conversationHistory,
        personalization,
        agentId: rawAgentId,
        agentType: rawAgentType,
      } = req.body;

      // Valider agentId/agentType — seuls "preset" et "custom" sont autorisés
      const validAgentTypes = ["preset", "custom"] as const;
      const agentType =
        typeof rawAgentType === "string" &&
        validAgentTypes.includes(rawAgentType as "preset" | "custom")
          ? (rawAgentType as "preset" | "custom")
          : undefined;
      const agentId =
        agentType && typeof rawAgentId === "string" && rawAgentId.length <= 100
          ? rawAgentId
          : undefined;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Le champ "messages" est requis et doit être un tableau',
        });
      }

      if (messages.length > MAX_MESSAGES_COUNT) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: `Maximum ${MAX_MESSAGES_COUNT} messages autorisés`,
        });
      }
      for (const msg of messages) {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        if (content && content.length > MAX_MESSAGE_LENGTH) {
          return res.status(400).json({
            error: "VALIDATION_ERROR",
            message: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères)`,
          });
        }
      }

      if (!workspaceId) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Le champ "workspaceId" est requis',
        });
      }

      if (!isAgentMode(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Mode invalide. Valeurs acceptées: "fast", "deep"',
        });
      }

      const lastUserMessage = extractLastUserMessage(messages);
      const intent = detectIntent(lastUserMessage);

      logger.log(`🤖 [AGENT-CHAT] Requête reçue:`, {
        userId,
        workspaceId,
        mode,
        intent,
        useWeb,
        messagesCount: messages.length,
        ragSourcesCount: ragSources?.length || 0,
        ragSources:
          ragSources?.map(
            (s: { id: string; title: string; type?: string }) =>
              `${s.type || "unknown"}:${s.title}`,
          ) || [],
        hasPersonalization: !!personalization,
        personalizationKeys: personalization ? Object.keys(personalization) : [],
      });

      const estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4);

      const quotaCheck = await AIQuotaManager.checkQuota(
        MODELS.AGENT_THINKING,
        estimatedTokens,
        estimateOutputTokens(mode),
        userId,
      );

      if (!quotaCheck.allowed) {
        logger.warn(`⚠️ [QUOTA] Requête bloquée: ${quotaCheck.reason}`);
        return res.status(429).json({
          error: "QUOTA_EXCEEDED",
          message: quotaCheck.reason,
          usage: quotaCheck.usage,
          limits: quotaCheck.limits,
        });
      }

      if (conversationId) {
        await saveConversation({
          conversationId,
          userId,
          workspaceId,
          messages: messages as UIMessage[],
          mode,
          status: "STREAMING",
          agentId,
          agentType,
        });
      }

      const [modelMessages, memories] = await Promise.all([
        convertToModelMessages(messages as UIMessage[]),
        searchMemories(userId, lastUserMessage),
      ]);
      const memoryContext = memories.map((m) => m.memory);

      let agentPrompt: { name: string; systemPrompt: string } | undefined;
      if (agentId && agentType) {
        if (agentType === "preset") {
          const preset = getPresetAgent(agentId);
          if (preset) {
            agentPrompt = { name: preset.name, systemPrompt: preset.systemPrompt };
          }
        } else if (agentType === "custom") {
          const custom = await prisma.customAgent.findFirst({
            where: { id: agentId, userId, isActive: true },
            select: { name: true, systemPrompt: true },
          });
          if (custom) {
            agentPrompt = { name: custom.name, systemPrompt: custom.systemPrompt };
          }
        }
      }

      const result = await runPennoteAgent(
        {
          messages: modelMessages,
          mode,
          intent,
          userId,
          workspaceId,
          useWeb,
          ragSources,
          conversationHistory,
          personalization,
          memoryContext,
          agentId,
          agentType,
          agentPrompt,
        },
        {
          onStepFinish: ({ stepNumber, toolCalls, text }) => {
            logger.log(`📍 [AGENT-CHAT] Step ${stepNumber}:`, {
              toolCalls: toolCalls.length,
              hasText: !!text,
            });
          },
          onToolCall: (toolName, _args) => {
            logger.log(`🔧 [AGENT-CHAT] Tool call: ${toolName}`);
          },
        },
      );

      const cost = req.aiCredits?.cost ?? calculateDynamicCost(req);
      logger.log(`✅ [AUDIT] Agent chat: userId=${userId}, mode=${mode}, cost=${cost}`);

      result.pipeUIMessageStreamToResponse(res, {
        originalMessages: messages as UIMessage[],
        sendReasoning: true,
        generateMessageId: generateId,
        async consumeSseStream({ stream }) {
          if (!conversationId) return;
          const streamId = generateId();
          const ctx = getStreamContext();
          await ctx.createNewResumableStream(streamId, () => stream);
          await updateActiveStreamId(conversationId, streamId, userId);
          logger.log(`🔄 [RESUME] Stream créé: ${streamId} pour ${conversationId}`);
        },
        onFinish: buildOnFinish({
          conversationId,
          userId,
          workspaceId,
          mode,
          agentId,
          agentType,
          estimatedTokens,
          lastUserMessage,
          aiAction: req.aiCredits?.action,
        }),
      });

      // CRITICAL: consumeStream() garantit que le stream se termine
      // même si le client se déconnecte (tab switch, refresh, etc.)
      result.consumeStream();
    } catch (error: unknown) {
      handleChatError(error, req, res);
    }
  },
);
