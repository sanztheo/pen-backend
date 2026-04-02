/**
 * Agent Workflow Routes
 *
 * POST /workflow — Deep research, content creation
 * GET /modes — Available modes metadata
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import { requireAICredits } from "../../middlewares/requireAICredits.js";
import { detectIntent, type AgentMode } from "../../services/agent/index.js";
import { AIQuotaManager } from "../../services/ai/quotaManager.js";
import {
  runDeepResearchWorkflow,
  runDeepContentWorkflow,
  runQuickContentWorkflow,
} from "../../services/agent/workflows.js";
import { AICreditsService } from "../../services/credits/aiCreditsService.js";
import { verifyWorkspaceAccess } from "../../middlewares/workspaceAccess.js";
import { MODELS } from "../../config/models.js";
import { addMemories } from "../../services/mem0/mem0Client.js";
import { aiConcurrencyLimit } from "../../middlewares/aiConcurrencyLimit.js";
import { dailyTokenQuota } from "../../middlewares/dailyTokenQuota.js";

import { calculateDynamicCost, estimateOutputTokens, type WorkflowResult } from "./helpers.js";

export const workflowRouter = Router();

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
workflowRouter.post(
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
workflowRouter.get("/modes", (_req: Request, res: Response) => {
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
