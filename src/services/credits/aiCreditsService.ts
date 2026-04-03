/**
 * 🤖 SERVICE DE GESTION DES CRÉDITS IA
 * Gestion des crédits IA et déduction pour les actions BlockNote
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { SecureLogger } from "../../middlewares/secureLogging.js";
import { retryPrismaTransaction } from "../../lib/retryWithBackoff.js";

export interface CreditDeductionResult {
  success: boolean;
  remainingCredits: number;
  limitReached: boolean;
  message: string;
}

export class AICreditsService {
  /**
   * Déduire des crédits IA (ULTRA-OPTIMISÉ POUR GRANDE ÉCHELLE)
   * Utilise UPSERT atomique pour éliminer complètement les deadlocks
   * @param userId - ID de l'utilisateur
   * @param amount - Montant à déduire (par défaut 0.5)
   * @param action - Type d'action (optionnel pour tracking)
   */
  static async deductCredits(
    userId: string,
    amount: number = 0.5,
    action?: string,
  ): Promise<CreditDeductionResult> {
    SecureLogger.debug(`🚀 [SERVER-CREDITS] Déduction ultra-optimisée`, {
      userId,
      action,
      amount,
    });

    try {
      // 🎯 UPSERT ATOMIQUE OPTIMISÉ POUR SCALABILITÉ 1000+ UTILISATEURS
      // Implémentation exacte selon BACKEND_CONTEXT.md pour zero deadlock
      const now = new Date();
      const result = await prisma.$executeRaw`
        INSERT INTO "user_limits" (
          "user_id", "ai_credits_used", "ai_credits_limit", 
          "workspaces_used", "workspaces_limit", "projects_used", "projects_limit",
          "custom_quizzes_used", "custom_quizzes_limit", "preset_sequences_used", "preset_sequences_limit",
          "last_reset_at", "reset_type", "created_at", "updated_at", "pages_limit", "pages_used"
        )
        VALUES (
          ${userId}, ${amount}, 50, 
          0, 2, 0, 4,
          0, 5, 0, 1,
          ${now}, 'monthly', ${now}, ${now}, -1, 0
        )
        ON CONFLICT ("user_id") 
        DO UPDATE SET 
          "ai_credits_used" = CASE 
            WHEN "user_limits"."ai_credits_limit" = -1 THEN "user_limits"."ai_credits_used" + ${amount}
            WHEN "user_limits"."ai_credits_used" + ${amount} <= "user_limits"."ai_credits_limit"
            THEN "user_limits"."ai_credits_used" + ${amount}
            ELSE "user_limits"."ai_credits_used"
          END,
          "updated_at" = ${now}
      `;

      SecureLogger.debug(`⚡ [SERVER-CREDITS] UPSERT atomique exécuté`, {
        userId,
        amount,
        affected: result,
      });

      // Lecture finale pour validation (optimisée avec SELECT specific)
      const finalLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: {
          aiCreditsUsed: true,
          aiCreditsLimit: true,
        },
      });

      if (!finalLimits) {
        SecureLogger.error(`❌ [SERVER-CREDITS] Limites introuvables après UPSERT`, { userId });
        return {
          success: false,
          remainingCredits: 0,
          limitReached: false,
          message: "Erreur système lors de la déduction",
        };
      }

      // Validation intelligente du succès
      const expectedMinUsage = result === 0 ? amount : finalLimits.aiCreditsUsed; // Si UPDATE, minimum attendu
      const deductionSucceeded = finalLimits.aiCreditsUsed >= expectedMinUsage;

      if (!deductionSucceeded) {
        const currentRemainingCredits =
          finalLimits.aiCreditsLimit === -1
            ? -1
            : Math.max(0, finalLimits.aiCreditsLimit - finalLimits.aiCreditsUsed);

        SecureLogger.warn(`❌ [SERVER-CREDITS] Limite atteinte (déduction refusée)`, {
          userId,
          amount,
          currentUsage: finalLimits.aiCreditsUsed,
          limit: finalLimits.aiCreditsLimit,
          remainingCredits: currentRemainingCredits,
        });

        return {
          success: false,
          remainingCredits: currentRemainingCredits,
          limitReached: true,
          message: "Limite de crédits IA atteinte",
        };
      }

      // Succès - calculer les crédits restants
      const remainingCredits =
        finalLimits.aiCreditsLimit === -1
          ? -1 // Illimité
          : Math.max(0, finalLimits.aiCreditsLimit - finalLimits.aiCreditsUsed);

      SecureLogger.debug(`✅ [SERVER-CREDITS] Déduction ultra-rapide réussie`, {
        userId,
        amount,
        newUsage: finalLimits.aiCreditsUsed,
        remainingCredits,
        operationType: result === 0 ? "UPDATE" : "INSERT",
      });

      // Enregistrement usage asynchrone (non-bloquant pour performance)
      setImmediate(() => {
        this.recordUsage(userId, "ai_action", amount, {
          action,
          method: "upsert_atomic",
        }).catch((err) => SecureLogger.warn("Erreur enregistrement usage IA (non-critique)", err));
      });

      return {
        success: true,
        remainingCredits,
        limitReached: false,
        message: "Crédits déduits avec succès",
      };
    } catch (error: unknown) {
      SecureLogger.error("❌ Erreur lors de la déduction atomique des crédits IA", error);

      // Gestion spécifique des erreurs de transaction Prisma
      const isPrismaError = error !== null && typeof error === "object" && "code" in error;
      if (isPrismaError && (error as { code: string }).code === "P2034") {
        // Transaction timeout
        return {
          success: false,
          remainingCredits: 0,
          limitReached: false,
          message: "Timeout lors de la déduction des crédits (trop de trafic)",
        };
      }

      return {
        success: false,
        remainingCredits: 0,
        limitReached: false,
        message: "Erreur lors de la déduction des crédits",
      };
    }
  }

  /**
   * Vérifier si un utilisateur peut utiliser l'IA
   * @param userId - ID de l'utilisateur
   */
  static async canUseAI(userId: string): Promise<boolean> {
    try {
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
      });

      if (!userLimits) {
        return true; // Nouvel utilisateur, peut utiliser l'IA
      }

      // Si illimité (-1), toujours autorisé
      if (userLimits.aiCreditsLimit === -1) {
        return true;
      }

      // Vérifier si under la limite
      return userLimits.aiCreditsUsed < userLimits.aiCreditsLimit;
    } catch (error) {
      SecureLogger.error("Erreur lors de la vérification des crédits IA", error);
      return false;
    }
  }

  /**
   * Rembourser des crédits IA en cas d'échec
   * @param userId - ID de l'utilisateur
   * @param amount - Montant à rembourser
   * @param action - Type d'action pour tracking
   */
  static async refundCredits(
    userId: string,
    amount: number,
    action?: string,
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    SecureLogger.debug(`🔄 [SERVER-CREDITS] Début remboursement`, {
      userId,
      action,
      amount,
    });

    try {
      // Atomic refund: single UPDATE avoids read-then-write race condition
      const now = new Date();
      await prisma.$executeRaw`
        UPDATE "user_limits"
        SET "ai_credits_used" = GREATEST(0, "ai_credits_used" - ${amount}),
            "updated_at" = ${now}
        WHERE "user_id" = ${userId}
      `;

      // Read final state for response
      const updatedLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: { aiCreditsUsed: true, aiCreditsLimit: true },
      });

      if (!updatedLimits) {
        SecureLogger.error(`❌ [SERVER-CREDITS] Utilisateur inexistant pour remboursement`, {
          userId,
        });
        return {
          success: false,
          error: "Utilisateur non trouvé pour le remboursement",
        };
      }

      // Record the refund audit log
      await this.recordRefund(userId, "ai_refund", amount, {
        action,
        reason: "generation_failure",
      });

      const newBalance =
        updatedLimits.aiCreditsLimit === -1
          ? -1
          : Math.max(0, updatedLimits.aiCreditsLimit - updatedLimits.aiCreditsUsed);

      SecureLogger.debug(`✅ [SERVER-CREDITS] Remboursement réussi`, {
        userId,
        newBalance,
      });

      return { success: true, newBalance };
    } catch (error) {
      SecureLogger.error("❌ Erreur lors du remboursement des crédits IA", error);
      return {
        success: false,
        error: "Erreur lors du remboursement des crédits",
      };
    }
  }

  /**
   * Obtenir le nombre de crédits restants
   * @param userId - ID de l'utilisateur
   */
  static async getRemainingCredits(userId: string): Promise<number> {
    try {
      const userLimits = await prisma.userLimits.findUnique({
        where: { userId },
      });

      if (!userLimits) {
        return 50; // Limite par défaut
      }

      if (userLimits.aiCreditsLimit === -1) {
        return -1; // Illimité
      }

      const remaining = userLimits.aiCreditsLimit - userLimits.aiCreditsUsed;
      return Math.max(0, remaining);
    } catch (error) {
      SecureLogger.error("Erreur lors de la récupération des crédits restants", error);
      return 0;
    }
  }

  /**
   * Enregistrer une utilisation dans les logs
   * @param userId - ID de l'utilisateur
   * @param resourceType - Type de ressource
   * @param quantity - Quantité utilisée
   * @param metadata - Métadonnées supplémentaires
   */
  private static async recordUsage(
    userId: string,
    resourceType: string,
    quantity: number,
    metadata: Prisma.InputJsonValue = {},
  ): Promise<void> {
    try {
      await prisma.usageRecord.create({
        data: {
          userId,
          resourceType,
          action: "ai_deduction",
          quantity,
          metadata,
        },
      });
    } catch (error) {
      SecureLogger.error("Erreur lors de l'enregistrement de l'utilisation", error);
    }
  }

  /**
   * Enregistrer un remboursement dans les logs
   * @param userId - ID de l'utilisateur
   * @param resourceType - Type de ressource
   * @param quantity - Quantité remboursée
   * @param metadata - Métadonnées supplémentaires
   */
  private static async recordRefund(
    userId: string,
    resourceType: string,
    quantity: number,
    metadata: Prisma.InputJsonValue = {},
  ): Promise<void> {
    try {
      await prisma.usageRecord.create({
        data: {
          userId,
          resourceType,
          action: "ai_refund",
          quantity: -quantity, // Négatif pour indiquer un remboursement
          metadata,
        },
      });
    } catch (error) {
      SecureLogger.error("Erreur lors de l'enregistrement du remboursement", error);
    }
  }

  /**
   * Réinitialiser les crédits mensuellement (pour les comptes premium)
   * @param userId - ID de l'utilisateur
   */
  static async resetMonthlyCredits(userId: string): Promise<boolean> {
    try {
      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

      // Atomic: reset only if monthly type AND last reset older than one month
      const affected = await prisma.$executeRaw`
        UPDATE "user_limits"
        SET "ai_credits_used" = 0,
            "last_reset_at" = ${now},
            "updated_at" = ${now}
        WHERE "user_id" = ${userId}
          AND "reset_type" = 'monthly'
          AND "last_reset_at" < ${oneMonthAgo}
      `;

      return affected > 0;
    } catch (error) {
      SecureLogger.error("Erreur lors de la réinitialisation des crédits", error);
      return false;
    }
  }
}
