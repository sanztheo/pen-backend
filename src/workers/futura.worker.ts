/**
 * 📰 FUTURA ARTICLE WORKER
 *
 * Worker pour rafraîchir automatiquement l'article scientifique hebdomadaire.
 * S'exécute automatiquement chaque lundi à 8h pour récupérer un nouvel article.
 *
 * Jobs traités:
 * - refresh-weekly-article: Rafraîchissement hebdomadaire automatique
 */

import { logger } from "../utils/logger.js";
import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { FuturaRssService } from "../services/futuraRss.service.js";

// Types de jobs Futura
export interface FuturaJobData {
  type: "refresh-weekly-article";
  forceNew?: boolean;
}

export interface FuturaResult {
  success: boolean;
  articleId?: string;
  title?: string;
  error?: string;
}

// 🔧 Processeur de jobs Futura
const processJob = async (job: Job<FuturaJobData>): Promise<FuturaResult> => {
  const { type, forceNew = false } = job.data;

  logger.log(`📰 [Futura Worker] Traitement job: ${type}`);

  try {
    if (type === "refresh-weekly-article") {
      // Récupérer un nouvel article depuis Futura Sciences
      const article = await FuturaRssService.fetchLatestArticle();

      if (!article) {
        throw new Error("Aucun article trouvé dans le flux RSS");
      }

      // Sauvegarder l'article dans la base de données
      const savedArticle = await FuturaRssService.saveWeeklyArticle(article, forceNew);

      if (!savedArticle) {
        throw new Error("Échec de la sauvegarde de l'article");
      }

      logger.log(`✅ [Futura Worker] Article sauvegardé: "${savedArticle.title}"`);

      return {
        success: true,
        articleId: savedArticle.id,
        title: savedArticle.title,
      };
    }

    throw new Error(`Type de job inconnu: ${type}`);
  } catch (error) {
    logger.error(`❌ [Futura Worker] Erreur:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
};

// 🎯 Création du worker Futura
export const futuraWorker = new Worker<FuturaJobData, FuturaResult>("futura", processJob, {
  connection: redis as unknown as import("bullmq").ConnectionOptions,
  concurrency: 1, // Un seul job à la fois pour éviter les conflits
  limiter: {
    max: 5, // Maximum 5 jobs par période
    duration: 60000, // Sur 60 secondes
  },
});

// 📊 Events du worker
futuraWorker.on("completed", (job, result) => {
  logger.log(`✅ [Futura Worker] Job ${job.id} complété`, result);
});

futuraWorker.on("failed", (job, error) => {
  logger.error(`❌ [Futura Worker] Job ${job?.id} échoué:`, error);
});

futuraWorker.on("error", (error) => {
  logger.error(`❌ [Futura Worker] Erreur du worker:`, error);
});

logger.log("✅ [Futura Worker] Démarré et en attente de jobs");
