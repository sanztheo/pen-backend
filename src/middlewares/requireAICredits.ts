/**
 * 🤖 MIDDLEWARE D'ENFORCEMENT DES CRÉDITS IA
 * Vérifie et déduit les crédits IA avant d'autoriser l'accès aux endpoints IA
 */

import { Request, Response, NextFunction } from "express";
import { AICreditsService } from "../services/credits/aiCreditsService.js";
import { AuthUser } from "../services/auth.js";
import { prisma } from "../lib/prisma.js";
import { secureLog } from "../lib/secureLogging.js";

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

      // SÉCURITÉ: Vérifier que l'utilisateur existe en base de données
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!userExists) {
        secureLog(
          "error: ❌ [AI-CREDITS] Tentative d'utilisation pour un utilisateur inexistant",
          { userId },
        );
        return res.status(404).json({
          success: false,
          error: "Utilisateur non trouvé",
          code: "USER_NOT_FOUND",
        });
      }

      // 💰 Calculer le coût (dynamique si fourni, sinon fixe)
      const cost = config.dynamicCost
        ? config.dynamicCost(req)
        : (config.cost ?? 0.5);
      const action =
        config.action || `ai_${req.path.replace(/[^a-zA-Z0-9]/g, "_")}`;

      // 1. Vérifier si l'utilisateur peut utiliser l'IA
      const canUse = await AICreditsService.canUseAI(userId);
      if (!canUse) {
        secureLog("warn: 🚨 [AI-CREDITS] Tentative usage IA sans crédits", {
          userId,
          path: req.path,
          action,
        });
        return res.status(403).json({
          success: false,
          error: "Limite de crédits IA atteinte",
          code: "CREDITS_EXHAUSTED",
          limitReached: true,
        });
      }

      // 2. Déduire les crédits
      const deductionResult = await AICreditsService.deductCredits(
        userId,
        cost,
        action,
      );
      if (!deductionResult.success) {
        secureLog("warn: 🚨 [AI-CREDITS] Échec déduction crédits", {
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
          remainingCredits: deductionResult.remainingCredits,
          limitReached: deductionResult.limitReached,
        });
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
