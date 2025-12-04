/**
 * 📅 FUTURA ARTICLE SCHEDULER
 *
 * Configure et initialise le rafraîchissement automatique hebdomadaire
 * de l'article scientifique depuis Futura Sciences.
 *
 * Le job s'exécute automatiquement chaque lundi à 8h00 (heure du serveur).
 */

import { futuraQueue } from "./queues.js";
import type { FuturaJobData } from "../workers/futura.worker.js";

/**
 * Initialise le job répétable pour le rafraîchissement hebdomadaire
 * S'exécute automatiquement chaque lundi à 8h00
 */
export const initFuturaScheduler = async () => {
  try {
    console.log("📅 [Futura Scheduler] Initialisation du planificateur...");

    // Nettoyer les anciens jobs répétables s'ils existent
    const repeatableJobs = await futuraQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await futuraQueue.removeRepeatableByKey(job.key);
      console.log(
        `🧹 [Futura Scheduler] Ancien job répétable supprimé: ${job.key}`,
      );
    }

    // Créer un job répétable qui s'exécute chaque lundi à 8h00
    const jobData: FuturaJobData = {
      type: "refresh-weekly-article",
      forceNew: false, // Ne force pas un nouvel article si un existe déjà pour cette semaine
    };

    await futuraQueue.add("refresh-weekly-article", jobData, {
      repeat: {
        pattern: "0 8 * * 1", // Cron: chaque lundi à 8h00
        // pattern: "0 8 * * 1" signifie:
        // minute=0, heure=8, jour du mois=*, mois=*, jour de la semaine=1 (lundi)
      },
      jobId: "weekly-article-refresh", // ID unique pour éviter les doublons
    });

    console.log(
      "✅ [Futura Scheduler] Job hebdomadaire configuré: chaque lundi à 8h00",
    );

    // Vérifier si un article existe pour cette semaine, sinon en créer un immédiatement
    await checkAndCreateInitialArticle();
  } catch (error) {
    console.error(
      "❌ [Futura Scheduler] Erreur lors de l'initialisation:",
      error,
    );
    throw error;
  }
};

/**
 * Vérifie si un article existe pour cette semaine
 * Si aucun article n'existe, crée un job immédiat pour en récupérer un
 */
const checkAndCreateInitialArticle = async () => {
  try {
    // Importer dynamiquement pour éviter les dépendances circulaires
    const { FuturaRssService } =
      await import("../services/futuraRss.service.js");

    // Vérifier si un article existe déjà pour cette semaine
    const existingArticle = await FuturaRssService.getWeeklyArticle();

    if (!existingArticle) {
      console.log(
        "📰 [Futura Scheduler] Aucun article pour cette semaine, création d'un job immédiat...",
      );

      const jobData: FuturaJobData = {
        type: "refresh-weekly-article",
        forceNew: false,
      };

      // Ajouter un job immédiat (sans repeat) pour récupérer un article maintenant
      await futuraQueue.add("refresh-weekly-article-initial", jobData, {
        priority: 1, // Priorité haute pour l'initialisation
      });

      console.log(
        "✅ [Futura Scheduler] Job de création initial ajouté à la queue",
      );
    } else {
      console.log(
        `ℹ️ [Futura Scheduler] Article existant trouvé: "${existingArticle.title}"`,
      );
    }
  } catch (error) {
    console.error(
      "❌ [Futura Scheduler] Erreur lors de la vérification initiale:",
      error,
    );
  }
};

/**
 * Arrête le planificateur en supprimant tous les jobs répétables
 */
export const stopFuturaScheduler = async () => {
  try {
    console.log("🛑 [Futura Scheduler] Arrêt du planificateur...");

    const repeatableJobs = await futuraQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await futuraQueue.removeRepeatableByKey(job.key);
    }

    console.log("✅ [Futura Scheduler] Planificateur arrêté");
  } catch (error) {
    console.error("❌ [Futura Scheduler] Erreur lors de l'arrêt:", error);
  }
};

/**
 * Déclenche manuellement un rafraîchissement de l'article
 * Utile pour tester ou forcer un nouvel article
 */
export const triggerManualRefresh = async (forceNew: boolean = false) => {
  try {
    console.log(
      "🔄 [Futura Scheduler] Déclenchement manuel du rafraîchissement...",
    );

    const jobData: FuturaJobData = {
      type: "refresh-weekly-article",
      forceNew,
    };

    const job = await futuraQueue.add(
      "refresh-weekly-article-manual",
      jobData,
      {
        priority: 2, // Priorité élevée pour les actions manuelles
      },
    );

    console.log(`✅ [Futura Scheduler] Job manuel créé avec l'ID: ${job.id}`);
    return job;
  } catch (error) {
    console.error(
      "❌ [Futura Scheduler] Erreur lors du déclenchement manuel:",
      error,
    );
    throw error;
  }
};
