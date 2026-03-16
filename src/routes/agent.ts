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
import { runPennoteAgent, type AgentMode } from "../services/agent/index.js";
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
    await updateActiveStreamId(req.params.id, null);
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

/**
 * 💰 Calcul dynamique du coût en crédits basé sur le mode
 */
const calculateDynamicCost = (req: Request): number => {
  const body = req.body || {};
  const mode = body.mode || "ask";

  switch (mode) {
    case "search":
    case "create-deep":
      return 2;
    case "ask":
    case "create-quick":
    default:
      return 1;
  }
};

/**
 * 📊 Estimation tokens de sortie selon le mode
 * - ask: réponses courtes
 * - search: réponses moyennes avec sources
 * - create-quick: contenu moyen
 * - create-deep: contenu long et détaillé
 */
const estimateOutputTokens = (mode: string): number => {
  switch (mode) {
    case "ask":
      return 2000;
    case "search":
      return 5000;
    case "create-quick":
      return 4000;
    case "create-deep":
      return 10000;
    default:
      return 3000;
  }
};

/**
 * POST /api/agent/chat
 *
 * Endpoint principal pour l'agent Pennote avec streaming SSE.
 *
 * Body attendu:
 * - messages: ModelMessage[] - Historique de conversation (format AI SDK)
 * - mode: "ask" | "search" | "create-quick" | "create-deep"
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
        mode = "ask",
        workspaceId,
        conversationId, // ID de la conversation pour persistance
        useWeb = false,
        ragSources,
        conversationHistory,
        personalization,
      } = req.body;

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

      // Valider le mode
      const validModes: AgentMode[] = ["ask", "search", "create-quick", "create-deep"];
      if (!validModes.includes(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: `Mode invalide. Valeurs acceptées: ${validModes.join(", ")}`,
        });
      }

      logger.log(`🤖 [AGENT-CHAT] Requête reçue:`, {
        userId,
        workspaceId,
        mode,
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
        });
      }

      // Convertir UIMessage[] (format frontend) vers ModelMessage[] (format AI SDK)
      const modelMessages = await convertToModelMessages(messages as UIMessage[]);

      // Exécuter l'agent Pennote
      const result = await runPennoteAgent(
        {
          messages: modelMessages,
          mode: mode as AgentMode,
          userId,
          workspaceId,
          useWeb,
          ragSources,
          conversationHistory,
          personalization,
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
          await updateActiveStreamId(conversationId, streamId);
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
            });
            await updateActiveStreamId(conversationId, null);
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
      if (failedConvId) {
        updateConversationStatus(failedConvId, "ERROR").catch(() => {});
        updateActiveStreamId(failedConvId, null).catch(() => {});
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
        mode = "ask",
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

      logger.log(`🤖 [AGENT-SIMPLE] Requête:`, {
        userId,
        workspaceId,
        mode,
        messagesCount: messages.length,
      });

      // Import dynamique pour éviter les problèmes de compilation
      const { runPennoteAgentSimple } = await import("../services/agent/index.js");

      // Convertir UIMessage[] vers ModelMessage[]
      const modelMessages = await convertToModelMessages(messages as UIMessage[]);

      const result = await runPennoteAgentSimple({
        messages: modelMessages,
        mode: mode as AgentMode,
        userId,
        workspaceId,
        useWeb,
        ragSources,
        conversationHistory,
        personalization,
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
 * Endpoint pour les workflows avancés (search, create-deep, create-quick).
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

      const validWorkflowModes = ["search", "create-quick", "create-deep"];
      if (!validWorkflowModes.includes(mode)) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: `Mode invalide pour workflow. Valeurs acceptées: ${validWorkflowModes.join(", ")}`,
        });
      }

      logger.log(`🚀 [WORKFLOW] Démarrage:`, {
        userId,
        workspaceId,
        mode,
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

      // Exécuter le workflow selon le mode
      let result: WorkflowResult;

      if (mode === "search") {
        // Workflow de recherche approfondie (même workflow que create-deep mais sans page auto)
        const { createPage: shouldCreatePage } = req.body;

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

        // Enregistrer l'usage
        await AIQuotaManager.recordUsage(
          MODELS.AGENT_THINKING,
          estimatedTokens,
          Math.ceil(result.content.length / 4),
          userId,
          userId,
          req.aiCredits?.action,
        );

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

      if (mode === "create-quick") {
        // Workflow de création rapide
        result = await runQuickContentWorkflow(
          {
            messages: [],
            mode: "create-quick",
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

        return res.json({
          success: true,
          type: "page",
          pageId: result.pageId,
          title: result.title,
          content: result.content,
        });
      }

      if (mode === "create-deep") {
        // Workflow de création approfondie avec recherche et évaluation
        result = await runDeepContentWorkflow(
          {
            messages: [],
            mode: "create-deep",
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

      return res.status(400).json({ error: "Mode non supporté" });
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
router.get("/modes", (req: Request, res: Response) => {
  res.json({
    modes: [
      {
        id: "ask",
        name: "Répondre",
        description: "Questions simples avec RAG",
        credits: 1,
        maxSteps: 10,
      },
      {
        id: "search",
        name: "Rechercher",
        description: "Recherche approfondie avec web",
        credits: 2,
        maxSteps: 25,
      },
      {
        id: "create-quick",
        name: "Créer (rapide)",
        description: "Génération rapide de contenu",
        credits: 1,
        maxSteps: 10,
      },
      {
        id: "create-deep",
        name: "Créer (approfondi)",
        description: "Génération complète avec recherche",
        credits: 2,
        maxSteps: 30,
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
