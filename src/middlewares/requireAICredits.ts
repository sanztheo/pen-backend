/**
 * 🤖 MIDDLEWARE D'ENFORCEMENT DES CRÉDITS IA
 * Vérifie et déduit les crédits IA avant d'autoriser l'accès aux endpoints IA
 */

import { Request, Response, NextFunction } from "express";
import { AICreditsService } from "../services/credits/aiCreditsService.js";
import { AuthUser } from "../services/auth.js";
import { secureLog } from "../lib/secureLogging.js";
import { findSelectableModel, PLAN_RANK } from "../config/models/selectable.js";
import { DailyModelLimitService } from "../services/credits/dailyModelLimit.js";
import { prisma } from "../lib/prisma.js";
import type { SubscriptionPlan } from "@prisma/client";

interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface AICreditsConfig {
  cost?: number;
  action?: string;
  dynamicCost?: (req: Request) => number; // 💰 NOUVEAU: Calcul dynamique du coût
}

/**
 * Middleware générique pour vérifier et déduire les crédits IA.
 * Doit être configuré directement dans les routes.
 * @example app.use('/path', requireAICredits({ cost: 1.0, action: 'my_action' }), ...);
 */
export const requireAICredits = (config: AICreditsConfig = {}) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Utilisateur non authentifié",
          code: "UNAUTHORIZED",
        });
      }

      // Calculer le coût (dynamique si fourni, sinon fixe)
      const baseCost = config.dynamicCost ? config.dynamicCost(req) : (config.cost ?? 1);
      const action = config.action || `ai_${req.path.replace(/[^a-zA-Z0-9]/g, "_")}`;
      // Fix: frontend sends modelSelection (composite ID), not modelId
      const modelCompositeId = (req.body?.modelSelection ?? req.body?.modelId) as
        | string
        | undefined;

      // STRICT validation (PRE-MORTEM #7): if the client sent a composite ID at all,
      // it MUST resolve to a known selectable model AND be allowed for the user's
      // current plan. Silent fallback to multiplier=1 let users invoke premium
      // models while being charged eco rates.
      let selectedModel = undefined as ReturnType<typeof findSelectableModel>;
      if (modelCompositeId) {
        selectedModel = findSelectableModel(modelCompositeId);
        if (!selectedModel) {
          secureLog("warn: [AI-CREDITS] Invalid model selection rejected", {
            userId,
            modelId: modelCompositeId,
          });
          return res.status(400).json({
            success: false,
            error: "INVALID_MODEL_SELECTION",
            modelId: modelCompositeId,
          });
        }

        const subscription = await prisma.userSubscription.findUnique({
          where: { userId },
          select: { plan: true },
        });
        const userPlan: SubscriptionPlan = subscription?.plan ?? "free_user";
        const planRank = PLAN_RANK[userPlan];
        const modelRequiredRank = PLAN_RANK[selectedModel.requiredPlan];

        if (planRank < modelRequiredRank) {
          secureLog("warn: [AI-CREDITS] Model not in plan", {
            userId,
            plan: userPlan,
            modelId: selectedModel.id,
            requiredPlan: selectedModel.requiredPlan,
          });
          return res.status(403).json({
            success: false,
            error: "MODEL_NOT_IN_PLAN",
            plan: userPlan,
            model: selectedModel.id,
          });
        }
      }

      const multiplier = selectedModel?.creditMultiplier ?? 1;
      const cost = baseCost * multiplier;

      const isExpensive =
        selectedModel &&
        (selectedModel.creditTier === "premium" || selectedModel.creditTier === "elite");
      if (isExpensive) {
        const dailyCheck = await DailyModelLimitService.checkDailyLimit(userId, cost);
        if (!dailyCheck.allowed) {
          return res.status(429).json({
            success: false,
            error: "DAILY_MODEL_LIMIT",
            message: `Limite quotidienne pour les modèles premium atteinte. ${dailyCheck.remaining} crédits restants aujourd'hui.`,
            code: "DAILY_MODEL_LIMIT",
            remaining: dailyCheck.remaining,
            dailyLimit: dailyCheck.dailyLimit,
            resetsAt: "midnight UTC",
          });
        }
      }

      const deductionResult = await AICreditsService.deductCredits(userId, cost, action);
      if (!deductionResult.success) {
        secureLog("warn: [AI-CREDITS] Credit deduction failed", {
          userId,
          path: req.path,
          action,
          cost,
          remainingCredits: deductionResult.remainingCredits,
        });
        return res.status(403).json({
          success: false,
          error: deductionResult.message,
          code: "CREDITS_DEDUCTION_FAILED",
          creditCost: cost,
          remainingCredits: deductionResult.remainingCredits,
          limitReached: deductionResult.limitReached,
        });
      }

      if (isExpensive) {
        await DailyModelLimitService.checkAndIncrement(userId, cost);
      }

      // 3. Ajouter infos crédits à la requête
      req.aiCredits = {
        cost,
        remainingCredits: deductionResult.remainingCredits,
        action,
      };

      secureLog("debug: ✅ [AI-CREDITS] Crédits déduits", {
        userId,
        path: req.path,
        action,
        cost,
        remainingCredits: deductionResult.remainingCredits,
      });

      next();
    } catch (error) {
      secureLog("error: ❌ [AI-CREDITS] Erreur middleware crédits IA", error);
      return res.status(500).json({
        success: false,
        error: "Erreur interne lors de la vérification des crédits",
        code: "CREDITS_CHECK_ERROR",
      });
    }
  };
};

// Étendre le type Request pour TypeScript
declare global {
  namespace Express {
    interface Request {
      aiCredits?: {
        cost: number;
        remainingCredits: number;
        action: string;
      };
    }
  }
}
