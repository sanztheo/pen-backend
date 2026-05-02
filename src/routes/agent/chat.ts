/**
 * Agent Chat Route
 *
 * POST /chat — Streaming principal (SSE, compatible useChat)
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { requireAICredits } from "../../middlewares/requireAICredits.js";
import { modelFallback } from "../../middlewares/modelFallback.js";
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
import { MODELS, findSelectableModel, parseCompositeId } from "../../config/models.js";
import { searchMemories } from "../../services/mem0/mem0Client.js";
import type { Mem0Memory } from "../../services/mem0/mem0Client.js";
import { getPresetAgent } from "../../services/agent/presetAgents.js";
import { aiConcurrencyLimit } from "../../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../../middlewares/dailyTokenQuota.js";
import { updateActiveStreamId } from "../../services/agent/conversationService.js";
import { redis } from "../../lib/redis.js";
import { createHash } from "crypto";
import { z } from "zod";

const MAX_SELECTION_TEXT_CHARS = 4000;
const MAX_SELECTION_BLOCK_IDS = 50;
const MEM0_CACHE_TTL_SECONDS = 600;

function buildMem0CacheKey(
  userId: string,
  conversationId: string | undefined,
  query: string,
): string {
  // Mem0 search is semantic — different queries yield different memories.
  // Hash the query into the key in both branches so the cache cannot serve
  // turn N's memories for turn N+1 of the same conversation.
  const hash = createHash("sha1").update(query).digest("hex").slice(0, 16);
  if (conversationId) {
    return `mem0:search:${userId}:${conversationId}:${hash}`;
  }
  return `mem0:search:${userId}:q:${hash}`;
}

async function searchMemoriesCached(
  userId: string,
  conversationId: string | undefined,
  query: string,
): Promise<Mem0Memory[]> {
  if (!query.trim()) return [];

  const key = buildMem0CacheKey(userId, conversationId, query);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as Mem0Memory[];
    }
  } catch (err) {
    logger.warn("[MEM0_CACHE] Redis read failed, falling back to API", err);
  }

  const memories = await searchMemories(userId, query);

  // Fire-and-forget: never block the user-facing chat on a cache write.
  redis
    .setex(key, MEM0_CACHE_TTL_SECONDS, JSON.stringify(memories))
    .catch((err: unknown) => logger.warn("[MEM0_CACHE] Redis write failed", err));

  return memories;
}

const selectionSchema = z
  .object({
    text: z.string().min(1).max(MAX_SELECTION_TEXT_CHARS),
    pageId: z.string().uuid().optional(),
    blockIds: z.array(z.string().uuid()).max(MAX_SELECTION_BLOCK_IDS).optional(),
  })
  .strict();

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
  modelFallback(calculateDynamicCost),
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
        modelSelection: rawModelSelection,
        autoAccept: rawAutoAccept,
        selection: rawSelection,
      } = req.body;

      const autoAccept = rawAutoAccept === true;

      // Editor selection — captured when the user opens chat from a page with text selected.
      // Zod validates pageId/blockIds are well-formed UUIDs so we do not waste a DB roundtrip
      // on garbage and so blockIds cannot smuggle non-uuid payloads into prompts.
      let selection: { pageId?: string; text: string; blockIds?: string[] } | undefined;
      if (rawSelection && typeof rawSelection === "object") {
        const parsed = selectionSchema.safeParse(rawSelection);
        if (parsed.success && parsed.data.text.trim().length > 0) {
          selection = {
            text: parsed.data.text,
            ...(parsed.data.pageId ? { pageId: parsed.data.pageId } : {}),
            ...(parsed.data.blockIds && parsed.data.blockIds.length > 0
              ? { blockIds: parsed.data.blockIds }
              : {}),
          };
        }
      }

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

      // Parse modelSelection composite ID → modelId + thinkingLevel
      let modelOverride: string | undefined;
      let thinkingOverride: string | undefined;
      const modelSelection =
        typeof rawModelSelection === "string" && rawModelSelection.length <= 100
          ? rawModelSelection
          : undefined;

      let modelDisplayName: string | undefined;
      if (modelSelection) {
        const selectable = findSelectableModel(modelSelection);
        if (selectable) {
          modelDisplayName = selectable.name;
          const parsed = parseCompositeId(modelSelection);
          if (parsed) {
            modelOverride = parsed.modelId;
            thinkingOverride = parsed.thinkingLevel;
          }
        } else {
          logger.warn(`[AGENT-CHAT] Invalid modelSelection "${modelSelection}", using default`);
        }
      }

      if (!messages || !Array.isArray(messages)) {
        logger.error("[AGENT-CHAT] 400 — messages missing or not array", {
          bodyKeys: Object.keys(req.body),
          messagesType: typeof messages,
          hasMessages: "messages" in req.body,
        });
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

      // IDOR guard — drop selection.pageId silently if it doesn't belong to this workspace.
      // Silent drop (not 400) avoids info disclosure: an attacker probing for arbitrary
      // page IDs gets the same response whether the page exists or not.
      if (selection?.pageId) {
        const ownedPage = await prisma.page.findFirst({
          where: { id: selection.pageId, workspaceId, isArchived: false },
          select: { id: true },
        });
        if (!ownedPage) {
          const { pageId: _droppedPageId, ...rest } = selection;
          selection = rest;
        }
      }

      const lastUserMessage = extractLastUserMessage(messages);
      const intent = detectIntent(lastUserMessage);

      logger.log(`🤖 [AGENT-CHAT] Requête reçue:`, {
        userId,
        workspaceId,
        mode,
        intent,
        useWeb,
        modelSelection: modelSelection || "default",
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
        searchMemoriesCached(userId, conversationId, lastUserMessage),
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
          modelOverride,
          thinkingOverride,
          autoAccept,
          selection,
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
        messageMetadata: ({ part }) => {
          if (part.type === "start") {
            const fb = req.modelFallback;
            return {
              model: modelDisplayName,
              ...(fb && {
                fallback: {
                  originalModel: fb.original.name,
                  fallbackModel: fb.fallback.name,
                  reason:
                    fb.reason === "insufficient_credits"
                      ? "insufficient_credits"
                      : "model_unavailable",
                },
              }),
            };
          }
        },
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
          modelSelection,
          modelId: modelOverride,
          thinkingLevel: thinkingOverride,
        }),
      });

      // CRITICAL: consumeStream() garantit que le stream se termine
      // même si le client se déconnecte (tab switch, refresh, etc.)
      Promise.resolve(result.consumeStream()).catch((err: unknown) => {
        // OpenAI Responses API: reasoning-delta can arrive before reasoning-start
        // in multi-step agent flows. Non-fatal — response still completes.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("reasoning-delta") || msg.includes("reasoning-start")) {
          logger.log(
            `⚠️ [AGENT-CHAT] Non-fatal reasoning stream error (OpenAI multi-step): ${msg}`,
          );
        } else {
          logger.error(`❌ [AGENT-CHAT] Stream consumption error:`, err);
        }
      });
    } catch (error: unknown) {
      handleChatError(error, req, res);
    }
  },
);
