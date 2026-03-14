import { Request, Response } from "express";
import { AIQuotaManager } from "../../services/ai/quotaManager.js";
import { logger } from "../../utils/logger.js";

/**
 * GET /api/ai/quota - Obtenir les statistiques d'usage des quotas OpenAI
 */
export const getQuotaStats = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    const stats = await AIQuotaManager.getUsageStats();

    res.json({
      message: "Statistiques de quota récupérées",
      stats: {
        usage: {
          requests: stats.usage.requests,
          tokens: stats.usage.tokens,
          cost: Number(stats.usage.cost.toFixed(4)),
          windowStart: stats.usage.windowStart,
        },
        limits: stats.limits,
        percentages: stats.percentages,
        status: {
          healthy:
            Math.max(stats.percentages.requests, stats.percentages.tokens, stats.percentages.cost) <
            80,
          warning:
            Math.max(
              stats.percentages.requests,
              stats.percentages.tokens,
              stats.percentages.cost,
            ) >= 80,
          critical:
            Math.max(
              stats.percentages.requests,
              stats.percentages.tokens,
              stats.percentages.cost,
            ) >= 95,
        },
        remainingTime: {
          ms: stats.remainingTime,
          humanReadable: formatDuration(stats.remainingTime),
        },
      },
    });
  } catch (error) {
    logger.error("Erreur récupération quota:", error);
    res.status(500).json({
      error: "Erreur lors de la récupération des quotas",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

/**
 * POST /api/ai/quota/reset - Réinitialiser les quotas (admin seulement)
 */
export const resetQuota = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Utilisateur non authentifié" });
    }

    // TODO: Vérifier que l'utilisateur est admin
    // const isAdmin = await checkUserIsAdmin(req.user.id);
    // if (!isAdmin) {
    //   return res.status(403).json({ error: 'Accès administrateur requis' });
    // }

    AIQuotaManager.resetCache();

    res.json({
      message: "Cache de quotas réinitialisé avec succès",
    });
  } catch (error) {
    logger.error("Erreur reset quota:", error);
    res.status(500).json({
      error: "Erreur lors de la réinitialisation des quotas",
      details: error instanceof Error ? error.message : "Erreur inconnue",
    });
  }
};

// Utilitaire pour formater la durée
function formatDuration(ms: number): string {
  if (ms <= 0) return "0ms";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return parts.length > 0 ? parts.join(" ") : "0s";
}
