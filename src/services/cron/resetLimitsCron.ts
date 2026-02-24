/**
 * 🕐 SERVICE CRON - RESET AUTOMATIQUE DES LIMITES
 * Reset quotidien automatique des limites utilisateur (quiz avancés)
 */

import cron from "node-cron";
import { prisma } from "../../lib/prisma.js";
import { SecureLogger } from "../../middlewares/secureLogging.js";

/**
 * 🔄 Reset automatique des quiz avancés (tous les jours à minuit)
 * Reset les compteurs pour les utilisateurs dont advancedQuizzesResetAt > 24h
 */
export function startDailyLimitsReset() {
  // Cron job: Tous les jours à 00:00 (minuit)
  cron.schedule("0 0 * * *", async () => {
    SecureLogger.log("🕐 [CRON] Démarrage du reset quotidien des limites");

    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Reset automatique pour tous les utilisateurs dont le reset date > 24h
      const result = await prisma.userLimits.updateMany({
        where: {
          advancedQuizzesResetAt: {
            lte: twentyFourHoursAgo,
          },
          advancedQuizzesUsed: {
            gt: 0, // Seulement ceux qui ont utilisé au moins 1 quiz avancé
          },
        },
        data: {
          advancedQuizzesUsed: 0,
          advancedQuizzesResetAt: null,
        },
      });

      if (result.count > 0) {
        SecureLogger.log(
          `✅ [CRON] Reset automatique réussi: ${result.count} utilisateur(s) réinitialisé(s)`,
          {
            count: result.count,
            timestamp: now.toISOString(),
          },
        );
      } else {
        SecureLogger.debug("✨ [CRON] Aucun utilisateur à réinitialiser");
      }
    } catch (error) {
      SecureLogger.error("❌ [CRON] Erreur lors du reset automatique des limites", error);
    }
  });

  SecureLogger.log("🕐 [CRON] Job de reset quotidien initialisé (tous les jours à minuit)");
}

/**
 * 🔄 Reset manuel des limites (utile pour les tests)
 * @returns Nombre d'utilisateurs réinitialisés
 */
export async function manualResetLimits(): Promise<number> {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const result = await prisma.userLimits.updateMany({
      where: {
        advancedQuizzesResetAt: {
          lte: twentyFourHoursAgo,
        },
        advancedQuizzesUsed: {
          gt: 0,
        },
      },
      data: {
        advancedQuizzesUsed: 0,
        advancedQuizzesResetAt: null,
      },
    });

    SecureLogger.log(`✅ [MANUAL-RESET] Reset manuel réussi: ${result.count} utilisateur(s)`, {
      count: result.count,
      timestamp: now.toISOString(),
    });

    return result.count;
  } catch (error) {
    SecureLogger.error("❌ [MANUAL-RESET] Erreur lors du reset manuel", error);
    throw error;
  }
}

/**
 * 🧪 Forcer le reset pour un utilisateur spécifique (utile pour les tests)
 * @param userId - ID de l'utilisateur à réinitialiser
 */
export async function forceResetUserLimits(userId: string): Promise<boolean> {
  try {
    await prisma.userLimits.update({
      where: { userId },
      data: {
        advancedQuizzesUsed: 0,
        advancedQuizzesResetAt: null,
      },
    });

    SecureLogger.log(`✅ [FORCE-RESET] Reset forcé pour l'utilisateur ${userId}`);
    return true;
  } catch (error) {
    SecureLogger.error(`❌ [FORCE-RESET] Erreur reset utilisateur ${userId}`, error);
    return false;
  }
}
