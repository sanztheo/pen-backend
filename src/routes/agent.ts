/**
 * 🤖 Route Agent Chat - Vercel AI SDK v6
 *
 * Endpoint principal pour l'agent Pennote avec streaming SSE.
 * Compatible avec useChat() côté frontend.
 *
 * @see https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

import { logger } from "../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAICredits } from "../middlewares/requireAICredits.js";
import {
  runPennoteAgent,
  detectIntent,
  extractLastUserMessage,
  type AgentMode,
} from "../services/agent/index.js";
import {
  saveConversation,
  loadConversation,
  listConversations,
  deleteConversation,
  updateConversationStatus,
  updateActiveStreamId,
  getConversationStatus,
} from "../services/agent/conversationService.js";
import { getStreamContext } from "../services/agent/resumableStreamService.js";
import { prisma } from "../lib/prisma.js";
import { AIQuotaManager } from "../services/ai/quotaManager.js";
import { convertToModelMessages, generateId } from "ai";
import type { UIMessage } from "ai";
import {
  runDeepResearchWorkflow,
  runDeepContentWorkflow,
  runQuickContentWorkflow,
} from "../services/agent/workflows.js";
import { AICreditsService } from "../services/credits/aiCreditsService.js";
import { verifyWorkspaceAccess } from "../middlewares/workspaceAccess.js";
import { MODELS } from "../config/models.js";
import { searchMemories, addMemories } from "../services/mem0/mem0Client.js";
import { getPresetAgent } from "../services/agent/presetAgents.js";

// Interface pour les résultats des workflows
interface WorkflowResult {
  content: string;
  title?: string;
  summary?: string;
  sources?: unknown[];
  searches?: unknown[];
  iterations?: number;
  pageId?: string | null;
  research?: {
    summary?: string;
    sources?: unknown[];
  };
}
import { aiConcurrencyLimit } from "../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../middlewares/dailyTokenQuota.js";

const router = Router();

// Authentification requise pour toutes les routes
router.use(authenticateToken);

// 🔄 GET /chat/:id/stream — Reprise de stream après refresh
// DOIT être AVANT les middlewares AI (pas de coût AI sur ce endpoint)
router.get("/chat/:id/stream", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Non authentifié" });

  const conversation = await prisma.aIConversation.findFirst({
    where: { id: req.params.id, userId },
    select: { activeStreamId: true },
  });

  if (!conversation?.activeStreamId) {
    return res.status(204).end();
  }

  const ctx = getStreamContext();
  const resumed = await ctx.resumeExistingStream(conversation.activeStreamId);

  if (!resumed) {
    await updateActiveStreamId(req.params.id, null, userId);
    return res.status(204).end();
  }

  // Headers SSE standard (même format que le AI SDK)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Vercel-AI-UI-Message-Stream": "v1",
    "X-Accel-Buffering": "no",
  });

  const reader = resumed.getReader();
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      res.write(chunk.value);
      chunk = await reader.read();
    }
  } catch (err) {
    logger.error("[RESUME-STREAM] Erreur lecture:", err);
  } finally {
    res.end();
  }
});

/** Credit cost per mode: fast=1, deep=3 */
const CREDIT_COSTS: Record<AgentMode, number> = {
  fast: 1,
  deep: 3,
};

/** Type guard — narrows string to AgentMode after validation */
function isAgentMode(mode: unknown): mode is AgentMode {
  return mode === "fast" || mode === "deep";
}

const calculateDynamicCost = (req: Request): number => {
  const body = req.body || {};
  const mode = body.mode;
  if (isAgentMode(mode)) return CREDIT_COSTS[mode];
  return CREDIT_COSTS.fast;
};

/** Estimated output tokens per mode for quota checks */
const ESTIMATED_OUTPUT_TOKENS: Record<AgentMode, number> = {
  fast: 2000,
  deep: 8000,
};

const estimateOutputTokens = (mode: string): number => {
  if (isAgentMode(mode)) return ESTIMATED_OUTPUT_TOKENS[mode];
  return ESTIMATED_OUTPUT_TOKENS.fast;
};

/**
 * POST /api/agent/chat
 *
 * Endpoint principal pour l'agent Pennote avec streaming SSE.
 *
 * Body attendu:
 * - messages: ModelMessage[] - Historique de conversation (format AI SDK)
 * - mode: "fast" | "deep"
 * - workspaceId: string - ID du workspace courant
 * - useWeb?: boolean - Activer la recherche web
 * - ragSources?: Array<{id, title}> - Sources RAG à utiliser
 * - conversationHistory?: string - Historique formaté
 * - personalization?: { name?, language?, style? }
 *
 * Réponse: SSE Data Stream (compatible useChat)
 */
router.post(
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
        conversationId, // ID de la conversation pour persistance
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

      // Validation des paramètres requis
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Le champ "messages" est requis et doit être un tableau',
        });
      }

      // SEC-03: Limite taille messages pour prévenir prompt injection / abus
      const MAX_MESSAGE_LENGTH = 50000;
      const MAX_MESSAGES_COUNT = 200;
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

      // Valider le mode via type guard
      if (!isAgentMode(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: 'Mode invalide. Valeurs acceptées: "fast", "deep"',
        });
      }

      // Auto-detect intent from last user message
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

      // 🛡️ Vérification quota par utilisateur (protection anti-spam)
      // Estimation: ~4 caractères par token
      const estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4);

      const quotaCheck = await AIQuotaManager.checkQuota(
        MODELS.AGENT_THINKING,
        estimatedTokens,
        estimateOutputTokens(mode), // Estimation dynamique selon le mode
        userId, // Quota par utilisateur
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

      // 💾 Sauvegarder la conversation AVANT le stream (status=STREAMING)
      // Ainsi, si l'utilisateur refresh pendant le streaming, la conversation existe en DB
      // Le frontend détecte status=STREAMING et poll jusqu'à COMPLETED
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

      // Convertir UIMessage[] + récupérer mémoires en parallèle
      const [modelMessages, memories] = await Promise.all([
        convertToModelMessages(messages as UIMessage[]),
        searchMemories(userId, lastUserMessage),
      ]);
      const memoryContext = memories.map((m) => m.memory);

      // Resolve agent prompt if an agent is selected
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

      // Exécuter l'agent Pennote avec mode × intent
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
          // Callbacks optionnels pour le logging
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

      // Log de la consommation
      const cost = req.aiCredits?.cost ?? calculateDynamicCost(req);
      logger.log(`✅ [AUDIT] Agent chat: userId=${userId}, mode=${mode}, cost=${cost}`);

      // 🔥 Vercel AI SDK v6: pipeUIMessageStreamToResponse avec onFinish pour persister
      // C'est la méthode recommandée pour Express - gère automatiquement le streaming
      result.pipeUIMessageStreamToResponse(res, {
        originalMessages: messages as UIMessage[],
        sendReasoning: true,
        generateMessageId: generateId,
        // 🔄 Resumable streams: sauvegarder une copie du stream SSE dans Redis
        // Permet au client de reprendre le stream après un refresh
        async consumeSseStream({ stream }) {
          if (!conversationId) return;
          const streamId = generateId();
          const ctx = getStreamContext();
          await ctx.createNewResumableStream(streamId, () => stream);
          await updateActiveStreamId(conversationId, streamId, userId);
          logger.log(`🔄 [RESUME] Stream créé: ${streamId} pour ${conversationId}`);
        },
        // 💾 Sauvegarder la conversation complète (status=COMPLETED)
        onFinish: async ({ messages: allMessages }) => {
          logger.log(`💾 [AGENT-CHAT] onFinish - Sauvegarde de ${allMessages.length} messages`);
          if (conversationId) {
            await saveConversation({
              conversationId,
              userId,
              workspaceId,
              messages: allMessages,
              mode,
              status: "COMPLETED",
              agentId,
              agentType,
            });
            await updateActiveStreamId(conversationId, null, userId);
          }

          // 📊 Enregistrer l'usage des tokens pour le quota par utilisateur
          try {
            const outputTokens = Math.ceil(JSON.stringify(allMessages).length / 4);

            await AIQuotaManager.recordUsage(
              MODELS.AGENT_THINKING,
              estimatedTokens,
              outputTokens,
              userId, // Quota par utilisateur
              userId, // Track per-user cost
              req.aiCredits?.action,
            );
            logger.log(
              `📊 [QUOTA] Usage enregistré pour ${userId}: ~${estimatedTokens + outputTokens} tokens`,
            );
          } catch (quotaError) {
            logger.error("⚠️ [QUOTA] Erreur enregistrement usage:", quotaError);
          }

          // 🧠 Mem0: stocker la conversation pour enrichir la mémoire (fire-and-forget)
          const lastAssistantMsg = allMessages
            .filter((m: UIMessage) => m.role === "assistant")
            .pop();
          if (lastUserMessage && lastAssistantMsg) {
            const assistantText = lastAssistantMsg.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("");
            if (assistantText) {
              addMemories(userId, [
                { role: "user", content: lastUserMessage.slice(0, 2000) },
                { role: "assistant", content: assistantText.slice(0, 2000) },
              ]).catch((err: unknown) => logger.warn("[MEM0] Uncaught add error:", err));
            }
          }
        },
      });

      // 🔑 CRITICAL: consumeStream() garantit que le stream se termine
      // même si le client se déconnecte (tab switch, refresh, etc.)
      // Cela assure que onFinish sera appelé et les messages sauvegardés
      // NE PAS await - cela bloque sans backpressure en arrière-plan
      result.consumeStream();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("❌ [AGENT-CHAT] Erreur:", error);

      // Marquer la conversation en erreur et clear le stream
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
  },
);

/**
 * POST /api/agent/chat/simple
 *
 * Version non-streaming pour les tests ou les cas simples.
 * Retourne la réponse complète en JSON.
 */
router.post(
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
      const { runPennoteAgentSimple } = await import("../services/agent/index.js");

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

/**
 * POST /api/agent/workflow
 *
 * Endpoint pour les workflows (deep research, content creation).
 * Utilise le système de workflow avec:
 * - Recherche parallèle (RAG, Web, Wikipedia, Workspace)
 * - Boucle d'évaluation et amélioration
 * - Création de page automatique
 *
 * Non-streaming - retourne le résultat complet en JSON.
 */
router.post(
  "/workflow",
  aiConcurrencyLimit,
  dailyTokenQuota,
  verifyWorkspaceAccess,
  requireAICredits({
    dynamicCost: calculateDynamicCost,
    action: "agent_workflow",
  }),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "Utilisateur non authentifié" });
      }

      const { prompt, mode, workspaceId, ragSources, personalization } = req.body;

      // Validation
      if (!prompt || !workspaceId) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "prompt et workspaceId sont requis",
        });
      }

      if (typeof prompt !== "string" || prompt.length > 50_000) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "prompt must be a string under 50,000 characters",
        });
      }

      const validWorkflowModes: AgentMode[] = ["fast", "deep"];
      if (!validWorkflowModes.includes(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: `Mode invalide pour workflow. Valeurs acceptées: ${validWorkflowModes.join(", ")}`,
        });
      }

      // Auto-detect intent from prompt, or use explicit intent from body
      const workflowIntent = req.body.intent || detectIntent(prompt);

      logger.log(`🚀 [WORKFLOW] Démarrage:`, {
        userId,
        workspaceId,
        mode,
        intent: workflowIntent,
        promptLength: prompt.length,
        ragSourcesCount: ragSources?.length || 0,
      });

      // 🛡️ Vérification quota
      const estimatedTokens = Math.ceil(prompt.length / 4);
      const quotaCheck = await AIQuotaManager.checkQuota(
        MODELS.AGENT_THINKING,
        estimatedTokens,
        estimateOutputTokens(mode),
        userId,
      );

      if (!quotaCheck.allowed) {
        return res.status(429).json({
          error: "QUOTA_EXCEEDED",
          message: quotaCheck.reason,
        });
      }

      // Helper: stocker le prompt + résultat dans Mem0 après un workflow
      const storeWorkflowMemory = (content: string): void => {
        addMemories(userId, [
          { role: "user", content: (prompt as string).slice(0, 2000) },
          { role: "assistant", content: content.slice(0, 2000) },
        ]).catch((err: unknown) => logger.warn("[MEM0] Uncaught workflow add error:", err));
      };

      // Exécuter le workflow selon le mode × intent
      const { createPage: shouldCreatePage } = req.body;
      let result: WorkflowResult;

      if (mode === "deep" && workflowIntent === "conversation") {
        // Deep research workflow (was "search" mode)
        result = await runDeepResearchWorkflow(
          prompt,
          {
            userId,
            workspaceId,
            ragSources,
            personalization,
          },
          { createPage: shouldCreatePage === true },
        );

        await AIQuotaManager.recordUsage(
          MODELS.AGENT_THINKING,
          estimatedTokens,
          Math.ceil(result.content.length / 4),
          userId,
          userId,
          req.aiCredits?.action,
        );

        storeWorkflowMemory(result.content);

        return res.json({
          success: true,
          type: "research",
          title: result.title,
          content: result.content,
          summary: result.summary,
          sources: result.sources,
          searchCount: result.searches?.length ?? 0,
          iterations: result.iterations,
          pageId: result.pageId || null,
        });
      }

      if (mode === "fast" && workflowIntent === "creation") {
        // Quick content workflow (was "create-quick" mode)
        result = await runQuickContentWorkflow(
          {
            messages: [],
            mode: "fast",
            userId,
            workspaceId,
            ragSources,
            personalization,
          },
          prompt,
        );

        await AIQuotaManager.recordUsage(
          MODELS.AGENT_THINKING,
          estimatedTokens,
          Math.ceil(result.content.length / 4),
          userId,
          userId,
          req.aiCredits?.action,
        );

        storeWorkflowMemory(result.content);

        return res.json({
          success: true,
          type: "page",
          pageId: result.pageId,
          title: result.title,
          content: result.content,
        });
      }

      if (mode === "deep" && workflowIntent === "creation") {
        // Deep content workflow (was "create-deep" mode)
        result = await runDeepContentWorkflow(
          {
            messages: [],
            mode: "deep",
            userId,
            workspaceId,
            ragSources,
            personalization,
          },
          prompt,
        );

        await AIQuotaManager.recordUsage(
          MODELS.AGENT_THINKING,
          estimatedTokens,
          Math.ceil(result.content.length / 4),
          userId,
          userId,
          req.aiCredits?.action,
        );

        storeWorkflowMemory(result.content);

        return res.json({
          success: true,
          type: "page",
          pageId: result.pageId,
          title: result.title,
          content: result.content,
          research: {
            summary: result.research?.summary,
            sources: result.research?.sources,
          },
          iterations: result.iterations,
        });
      }

      return res.status(400).json({ error: "Combinaison mode/intent non supportée" });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("❌ [WORKFLOW] Erreur:", error);

      const creditsCost = req.aiCredits?.cost;
      const refundUserId = req.user?.id;
      if (creditsCost && refundUserId) {
        AICreditsService.refundCredits(refundUserId, creditsCost, "workflow_error").catch(
          (err: unknown) => logger.error("[REFUND] Erreur refund workflow:", err),
        );
      }

      const safeMessage =
        process.env.NODE_ENV === "production"
          ? "Erreur lors de l'exécution du workflow"
          : errorMessage || "Erreur lors de l'exécution du workflow";
      res.status(500).json({
        error: "WORKFLOW_ERROR",
        message: safeMessage,
      });
    }
  },
);

/**
 * GET /api/agent/modes
 *
 * Retourne les modes disponibles et leur configuration.
 */
router.get("/modes", (_req: Request, res: Response) => {
  res.json({
    modes: [
      {
        id: "fast",
        name: "Fast",
        description: "Réponses rapides avec RAG",
        credits: 1,
        maxSteps: 10,
      },
      {
        id: "deep",
        name: "Deep",
        description: "Recherche approfondie et contenu détaillé",
        credits: 3,
        maxSteps: 25,
      },
    ],
  });
});

/**
 * GET /api/agent/conversations
 *
 * Liste les conversations de l'utilisateur
 */
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { workspaceId, limit } = req.query;

    const conversations = await listConversations(
      userId,
      workspaceId as string | undefined,
      limit ? parseInt(limit as string, 10) : 50,
    );

    res.json({ success: true, conversations });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur liste:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors de la récupération des conversations"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});

/**
 * GET /api/agent/conversations/:id
 *
 * Charge une conversation avec ses messages + status
 */
router.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { id } = req.params;

    const result = await loadConversation(id, userId);

    if (!result) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json({
      success: true,
      messages: result.messages,
      status: result.status,
      mode: result.mode,
      agentId: result.agentId ?? null,
      agentType: result.agentType ?? null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur chargement:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors du chargement de la conversation"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});

/**
 * GET /api/agent/conversations/:id/status
 *
 * Endpoint léger de polling — retourne uniquement le status + messageCount
 * Le frontend poll toutes les 2s quand status=STREAMING
 */
router.get("/conversations/:id/status", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const result = await getConversationStatus(req.params.id, userId);

    if (!result) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json(result);
  } catch (error: unknown) {
    logger.error("❌ [CONVERSATIONS] Erreur status:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * DELETE /api/agent/conversations/:id
 *
 * Supprime une conversation (soft delete)
 */
router.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { id } = req.params;

    const deleted = await deleteConversation(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur suppression:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors de la suppression de la conversation"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});

export { router as agentRouter };
