/**
 * 🛡️ MIDDLEWARE DE VÉRIFICATION DU PLAN PREMIUM
 * Vérifie que l'utilisateur a un abonnement premium actif avant d'autoriser l'accès aux fonctionnalités premium
 */

import { Request, Response, NextFunction } from "express";
import { AuthUser } from "../services/auth.js";
import { prisma } from "../lib/prisma.js";
import { secureLog } from "../lib/secureLogging.js";

interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Middleware pour vérifier qu'un utilisateur a un plan premium actif.
 * Bloque l'accès aux fonctionnalités premium pour les comptes gratuits.
 */
export const requirePremiumPlan = () => {
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

      // SÉCURITÉ: Vérifier l'abonnement en base de données
      const subscription = await prisma.userSubscription.findUnique({
        where: { userId },
        select: {
          id: true,
          plan: true,
          status: true,
          currentPeriodEnd: true,
        },
      });

      // Vérifier si l'utilisateur a un plan premium actif
      const hasPremiumPlan =
        subscription &&
        subscription.plan === "premium" &&
        subscription.status === "active" &&
        subscription.currentPeriodEnd &&
        new Date(subscription.currentPeriodEnd) > new Date();

      if (!hasPremiumPlan) {
        const planInfo = subscription ? subscription.plan : "no_subscription";
        const status = subscription?.status || "no_status";

        secureLog("warn: 🚨 [PREMIUM-CHECK] Accès refusé aux fonctionnalités premium", {
          userId,
          path: req.path,
          method: req.method,
          currentPlan: planInfo,
          subscriptionStatus: status,
          userAgent: req.get("User-Agent")?.slice(0, 100),
        });

        return res.status(403).json({
          success: false,
          error: "Abonnement premium requis pour cette fonctionnalité",
          code: "PREMIUM_REQUIRED",
          currentPlan: planInfo,
          upgradeRequired: true,
        });
      }

      // Ajouter les infos d'abonnement à la requête pour usage ultérieur
      if (!subscription.currentPeriodEnd) {
        return res.status(500).json({
          success: false,
          error: "Abonnement invalide (date de fin manquante)",
          code: "SUBSCRIPTION_INVALID",
        });
      }

      req.subscription = {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      };

      secureLog("debug: ✅ [PREMIUM-CHECK] Accès autorisé", {
        userId,
        path: req.path,
        plan: subscription.plan,
      });

      next();
    } catch (error) {
      secureLog("error: ❌ [PREMIUM-CHECK] Erreur middleware premium", error);
      return res.status(500).json({
        success: false,
        error: "Erreur lors de la vérification de l'abonnement",
        code: "SUBSCRIPTION_CHECK_ERROR",
      });
    }
  };
};

// Étendre le type Request pour TypeScript
declare global {
  namespace Express {
    interface Request {
      subscription?: {
        plan: string;
        status: string;
        currentPeriodEnd: Date;
      };
    }
  }
}
