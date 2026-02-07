import cron from "node-cron";
import { logger } from "../utils/logger.js";

/**
 * 🕐 TÂCHES CRON AUTOMATIQUES
 * Gestion des tâches en arrière-plan
 */

// Configuration des tâches
const HEALTH_CHECK_SCHEDULE = "0 */6 * * *"; // Toutes les 6 heures
const RAG_CLEANUP_SCHEDULE = "0 3 * * *"; // Tous les jours à 3h du matin
const DAILY_ARTICLE_SCHEDULE = "0 0 * * *"; // Tous les jours à minuit
const MONTHLY_RESET_SCHEDULE = "0 2 * * *"; // Tous les jours à 2h du matin
const DAILY_LIMITS_RESET_SCHEDULE = "0 0 * * *"; // Tous les jours à minuit
const BETA_CHECK_INACTIVE_SCHEDULE = "0 * * * *"; // :00 — désactive les inactifs en premier
const BETA_PROCESS_WAITLIST_SCHEDULE = "10 * * * *"; // :10 — promeut depuis la waitlist
const BETA_CLEANUP_EXPIRED_SCHEDULE = "20 * * * *"; // :20 — nettoie les comptes expirés (après check inactive)
const BETA_WEEKLY_RESET_SCHEDULE = "0 0 * * 1"; // Lundi 00:00 UTC
const NODE_ENV = process.env.NODE_ENV || "development";

export function startCronJobs() {
  logger.log("🕐 Démarrage des tâches CRON...");

  // 🩺 Vérification de santé de la base de données
  const healthCheckTask = cron.schedule(
    HEALTH_CHECK_SCHEDULE,
    async () => {
      logger.log("\n🩺 [CRON] Vérification de santé de la base de données...");
      try {
        const { prisma } = await import("../lib/prisma.js");

        // Vérifier la connexion à la base de données
        await prisma.$queryRaw`SELECT 1`;

        // Compter les pages et workspaces actifs
        const pageCount = await prisma.page.count();
        const workspaceCount = await prisma.workspace.count();

        logger.log(
          `✅ [CRON] Base de données saine - Pages: ${pageCount}, Workspaces: ${workspaceCount}`,
        );
      } catch (error) {
        logger.error(
          "❌ [CRON] Erreur lors de la vérification de santé:",
          error,
        );
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(
    `✅ Tâche de vérification de santé programmée: ${HEALTH_CHECK_SCHEDULE} (Europe/Paris)`,
  );

  // 🧹 Nettoyage automatique des embeddings RAG non utilisés
  const ragCleanupTask = cron.schedule(
    RAG_CLEANUP_SCHEDULE,
    async () => {
      logger.log("\n🧹 [CRON] Démarrage nettoyage RAG automatique...");
      try {
        const { cleanupService } = await import("../services/rag/cleanup.js");

        // Nettoyage avec 7 jours d'âge maximum
        const stats = await cleanupService.cleanupUnusedSources({
          maxAge: 7,
          dryRun: false,
          includeUserSources: false, // Seulement sources globales
          batchSize: 100,
        });

        logger.log(`✅ [CRON] Nettoyage RAG terminé:`, {
          sourcesDeleted: stats.sourcesDeleted,
          chunksDeleted: stats.chunksDeleted,
          spaceFreedMB: stats.spaceFreedMB.toFixed(2),
          durationMs: stats.duration,
        });

        // Log des statistiques de stockage après nettoyage
        const storageStats = await cleanupService.getStorageStats();
        logger.log(`📊 [CRON] Statistiques après nettoyage:`, storageStats);

        // 🗑️ Nettoyage des fichiers utilisateur non utilisés depuis 7 jours
        logger.log("\n🗑️ [CRON] Nettoyage des fichiers utilisateur...");
        const fileStats = await cleanupService.cleanupOldUserFiles(7);
        logger.log(`✅ [CRON] Fichiers utilisateurs nettoyés:`, {
          filesDeleted: fileStats.count,
          chunksDeleted: fileStats.chunksDeleted,
          spaceFreedMB: fileStats.spaceFreedMB.toFixed(2),
        });
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors du nettoyage RAG:", error);
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(
    `✅ Tâche de nettoyage RAG programmée: ${RAG_CLEANUP_SCHEDULE} (Europe/Paris)`,
  );

  // 📰 Fetch de l'article scientifique du jour (Futura Sciences)
  const dailyArticleTask = cron.schedule(
    DAILY_ARTICLE_SCHEDULE,
    async () => {
      logger.log("\n📰 [CRON] Fetch de l'article scientifique du jour...");
      try {
        const { FuturaRssService } =
          await import("../services/futuraRss.service.js");

        // Récupérer et sauvegarder l'article de la semaine
        const latestArticle = await FuturaRssService.fetchLatestArticle();

        if (latestArticle) {
          const savedArticle =
            await FuturaRssService.saveWeeklyArticle(latestArticle);

          if (savedArticle) {
            logger.log(
              `✅ [CRON] Article de la semaine sauvegardé: "${savedArticle.title.substring(0, 50)}..."`,
            );

            // Nettoyer les anciens articles (garder seulement 7 jours)
            const deletedCount = await FuturaRssService.cleanupOldArticles();
            logger.log(
              `🗑️ [CRON] ${deletedCount} ancien(s) article(s) supprimé(s)`,
            );
          } else {
            logger.warn("⚠️ [CRON] Article déjà existant pour cette semaine");
          }
        } else {
          logger.error(
            "❌ [CRON] Aucun article récupéré depuis Futura Sciences",
          );
        }
      } catch (error) {
        logger.error(
          "❌ [CRON] Erreur lors du fetch de l'article quotidien:",
          error,
        );
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(
    `✅ Tâche article quotidien programmée: ${DAILY_ARTICLE_SCHEDULE} (Europe/Paris)`,
  );

  // 🔄 Reset mensuel des limitations pour les users gratuits
  const monthlyResetTask = cron.schedule(
    MONTHLY_RESET_SCHEDULE,
    async () => {
      logger.log("\n🔄 [CRON] Démarrage du reset mensuel...");
      try {
        const { processMonthlyResets } = await import("../lib/monthlyReset.js");

        const result = await processMonthlyResets();

        logger.log(`✅ [CRON] Reset mensuel terminé:`, {
          usersReset: result.resetCount,
          downgrades: result.downgradeCount,
        });
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors du reset mensuel:", error);
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(
    `✅ Tâche de reset mensuel programmée: ${MONTHLY_RESET_SCHEDULE} (Europe/Paris)`,
  );

  // 🔄 Reset automatique quotidien des limites quiz avancés (24h)
  const dailyLimitsResetTask = cron.schedule(
    DAILY_LIMITS_RESET_SCHEDULE,
    async () => {
      logger.log(
        "\n🔄 [CRON] Démarrage du reset quotidien des limites quiz avancés...",
      );
      try {
        const { startDailyLimitsReset } =
          await import("../services/cron/resetLimitsCron.js");

        // Exécuter le reset immédiatement
        const { prisma } = await import("../lib/prisma.js");
        const now = new Date();
        const twentyFourHoursAgo = new Date(
          now.getTime() - 24 * 60 * 60 * 1000,
        );

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

        logger.log(
          `✅ [CRON] Reset quotidien terminé: ${result.count} utilisateur(s) réinitialisé(s)`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors du reset quotidien:", error);
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(
    `✅ Tâche de reset quotidien des limites programmée: ${DAILY_LIMITS_RESET_SCHEDULE} (Europe/Paris)`,
  );

  // ─── Beta Management Cron Jobs ──────────────────────────────

  // 🔍 Désactivation des utilisateurs inactifs (pas de heartbeat depuis 7 jours)
  const betaCheckInactiveTask = cron.schedule(
    BETA_CHECK_INACTIVE_SCHEDULE,
    async () => {
      logger.log("\n🔍 [CRON] Beta: vérification des utilisateurs inactifs...");
      try {
        const { BetaCronService } =
          await import("../services/BetaCronService.js");

        const result = await BetaCronService.checkInactiveUsers();

        logger.log(
          `✅ [CRON] Beta inactive check: ${result.processed} désactivés`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur beta inactive check:", error);
      }
    },
    {
      timezone: "UTC",
    },
  );

  logger.log(
    `✅ Tâche beta inactive check programmée: ${BETA_CHECK_INACTIVE_SCHEDULE} (UTC)`,
  );

  // 🔄 Reset hebdomadaire des compteurs beta (lundi 00:00 UTC)
  const betaWeeklyResetTask = cron.schedule(
    BETA_WEEKLY_RESET_SCHEDULE,
    async () => {
      logger.log("\n🔄 [CRON] Beta: reset hebdomadaire des compteurs...");
      try {
        const { BetaCronService } =
          await import("../services/BetaCronService.js");

        const result = await BetaCronService.resetWeeklyCounters();

        logger.log(
          `✅ [CRON] Beta weekly reset: ${result.processed} users reset`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur beta weekly reset:", error);
      }
    },
    {
      timezone: "UTC",
    },
  );

  logger.log(
    `✅ Tâche beta weekly reset programmée: ${BETA_WEEKLY_RESET_SCHEDULE} (UTC)`,
  );

  // 📋 Promotion automatique depuis la waitlist
  const betaProcessWaitlistTask = cron.schedule(
    BETA_PROCESS_WAITLIST_SCHEDULE,
    async () => {
      logger.log("\n📋 [CRON] Beta: traitement de la waitlist...");
      try {
        const { BetaCronService } =
          await import("../services/BetaCronService.js");

        const result = await BetaCronService.processWaitlist();

        logger.log(
          `✅ [CRON] Beta waitlist: ${result.processed} promus, ${result.errors} erreurs`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur beta waitlist processing:", error);
      }
    },
    {
      timezone: "UTC",
    },
  );

  logger.log(
    `✅ Tâche beta waitlist processing programmée: ${BETA_PROCESS_WAITLIST_SCHEDULE} (UTC)`,
  );

  // 🗑️ Nettoyage des comptes expirés (deadline de réactivation dépassée)
  const betaCleanupExpiredTask = cron.schedule(
    BETA_CLEANUP_EXPIRED_SCHEDULE,
    async () => {
      logger.log("\n🗑️ [CRON] Beta: nettoyage des comptes expirés...");
      try {
        const { BetaCronService } =
          await import("../services/BetaCronService.js");

        const result = await BetaCronService.cleanupExpiredAccounts();

        logger.log(
          `✅ [CRON] Beta cleanup: ${result.processed} comptes expirés`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur beta cleanup:", error);
      }
    },
    {
      timezone: "UTC",
    },
  );

  logger.log(
    `✅ Tâche beta cleanup programmée: ${BETA_CLEANUP_EXPIRED_SCHEDULE} (UTC)`,
  );

  // En développement, ajouter une tâche de test plus fréquente
  if (NODE_ENV === "development") {
    // Tâche de test toutes les 5 minutes (désactivée par défaut)
    const testEnabled = process.env.ENABLE_TEST_CRON === "true";

    if (testEnabled) {
      cron.schedule(
        "*/5 * * * *",
        async () => {
          logger.log("🧪 [TEST CRON] Vérification du statut...");
          try {
            const { prisma } = await import("../lib/prisma.js");
            const userCount = await prisma.user.count();
            logger.log(`🧪 [TEST] Utilisateurs: ${userCount}`);
          } catch (error) {
            logger.error("❌ [TEST CRON] Erreur:", error);
          }
        },
        {
          timezone: "Europe/Paris",
        },
      );

      logger.log("🧪 Tâche de test activée (toutes les 5 minutes)");
    }
  }

  return {
    healthCheck: healthCheckTask,
    ragCleanup: ragCleanupTask,
    dailyArticle: dailyArticleTask,
    monthlyReset: monthlyResetTask,
    dailyLimitsReset: dailyLimitsResetTask,
    betaCheckInactive: betaCheckInactiveTask,
    betaWeeklyReset: betaWeeklyResetTask,
    betaProcessWaitlist: betaProcessWaitlistTask,
    betaCleanupExpired: betaCleanupExpiredTask,
  };
}

export function stopCronJobs() {
  logger.log("🛑 Arrêt des tâches CRON...");
  // Note: Les tâches seront arrêtées automatiquement à l'arrêt du processus
  logger.log("✅ Tâches CRON arrêtées");
}

// Gestion propre des signaux de fermeture
process.on("SIGTERM", stopCronJobs);
process.on("SIGINT", stopCronJobs);
