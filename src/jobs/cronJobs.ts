import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { BETA_LIVE } from "../config/beta.js";

/**
 * 🕐 TÂCHES CRON AUTOMATIQUES
 * Gestion des tâches en arrière-plan
 */

// Configuration des tâches
const HEALTH_CHECK_SCHEDULE = "0 */6 * * *"; // Toutes les 6 heures
const RAG_CLEANUP_SCHEDULE = "0 3 * * *"; // Tous les jours à 3h du matin

const MONTHLY_RESET_SCHEDULE = "0 2 * * *"; // Tous les jours à 2h du matin
const DAILY_LIMITS_RESET_SCHEDULE = "0 0 * * *"; // Tous les jours à minuit
const BETA_CHECK_INACTIVE_SCHEDULE = "0 * * * *"; // :00 — désactive les inactifs en premier
const BETA_PROCESS_WAITLIST_SCHEDULE = "10 * * * *"; // :10 — promeut depuis la waitlist
const BETA_CLEANUP_EXPIRED_SCHEDULE = "20 * * * *"; // :20 — nettoie les comptes expirés (après check inactive)
const BETA_POSITION_UPDATES_SCHEDULE = "30 * * * *"; // :30 — envoie les emails de progression waitlist
const BETA_WEEKLY_RESET_SCHEDULE = "0 0 * * 1"; // Lundi 00:00 UTC
const TRASH_PURGE_SCHEDULE = "0 3 * * *"; // Tous les jours à 3h du matin (Europe/Paris)
const TRASH_PURGE_LOCK_TTL = 7200; // 2h — purges massives peuvent dépasser 1h
const TRASH_PURGE_LOCK_REFRESH_MS = 30 * 60 * 1000; // refresh toutes les 30min
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
        logger.error("❌ [CRON] Erreur lors de la vérification de santé:", error);
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
        const { redis } = await import("../lib/redis.js");
        const lockKey = "cron:lock:ragCleanup";
        const acquired = await redis.set(lockKey, "1", "EX", 3600, "NX");
        if (!acquired) {
          logger.log("[CRON] ragCleanup: skipped (another instance holds the lock)");
          return;
        }

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
        } finally {
          await redis.del(lockKey).catch((err: unknown) => {
            logger.warn("[CRON] Failed to release ragCleanup lock:", err);
          });
        }
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors du nettoyage RAG:", error);
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(`✅ Tâche de nettoyage RAG programmée: ${RAG_CLEANUP_SCHEDULE} (Europe/Paris)`);

  // 🔄 Reset mensuel des limitations pour les users gratuits
  const monthlyResetTask = cron.schedule(
    MONTHLY_RESET_SCHEDULE,
    async () => {
      logger.log("\n🔄 [CRON] Démarrage du reset mensuel...");
      try {
        const { redis } = await import("../lib/redis.js");
        const lockKey = "cron:lock:monthlyReset";
        const acquired = await redis.set(lockKey, "1", "EX", 300, "NX");
        if (!acquired) {
          logger.log("[CRON] monthlyReset: skipped (another instance holds the lock)");
          return;
        }

        try {
          const { processMonthlyResets } = await import("../lib/monthlyReset.js");

          const result = await processMonthlyResets();

          logger.log(`✅ [CRON] Reset mensuel terminé:`, {
            usersReset: result.resetCount,
            downgrades: result.downgradeCount,
          });
        } finally {
          await redis.del(lockKey).catch((err: unknown) => {
            logger.warn("[CRON] Failed to release monthlyReset lock:", err);
          });
        }
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors du reset mensuel:", error);
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(`✅ Tâche de reset mensuel programmée: ${MONTHLY_RESET_SCHEDULE} (Europe/Paris)`);

  // 🔄 Reset automatique quotidien des limites quiz avancés (24h)
  const dailyLimitsResetTask = cron.schedule(
    DAILY_LIMITS_RESET_SCHEDULE,
    async () => {
      logger.log("\n🔄 [CRON] Démarrage du reset quotidien des limites quiz avancés...");
      try {
        const { redis } = await import("../lib/redis.js");
        const lockKey = "cron:lock:dailyLimitsReset";
        const acquired = await redis.set(lockKey, "1", "EX", 300, "NX");
        if (!acquired) {
          logger.log("[CRON] dailyLimitsReset: skipped (another instance holds the lock)");
          return;
        }

        try {
          const { startDailyLimitsReset } = await import("../services/cron/resetLimitsCron.js");

          // Exécuter le reset immédiatement
          const { prisma } = await import("../lib/prisma.js");
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

          logger.log(
            `✅ [CRON] Reset quotidien terminé: ${result.count} utilisateur(s) réinitialisé(s)`,
          );
        } finally {
          await redis.del(lockKey).catch((err: unknown) => {
            logger.warn("[CRON] Failed to release dailyLimitsReset lock:", err);
          });
        }
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

  // 🗑️ Purge quotidienne des pages dans la corbeille depuis plus de 30 jours
  const trashPurgeTask = cron.schedule(
    TRASH_PURGE_SCHEDULE,
    async () => {
      logger.log("\n🗑️ [CRON] Démarrage purge corbeille (>30 jours)...");
      const { redis } = await import("../lib/redis.js");
      const lockKey = "cron:lock:trashPurge";
      const acquired = await redis.set(lockKey, "1", "EX", TRASH_PURGE_LOCK_TTL, "NX");
      if (!acquired) {
        logger.log("[CRON] trashPurge: skipped (another instance holds the lock)");
        return;
      }

      // Refresh périodique du lock pendant la purge (peut dépasser 1h sur gros volumes)
      const refreshHandle = setInterval(() => {
        redis.expire(lockKey, TRASH_PURGE_LOCK_TTL).catch((err: unknown) => {
          logger.warn("[CRON] trashPurge: failed to refresh lock TTL:", err);
        });
      }, TRASH_PURGE_LOCK_REFRESH_MS);

      try {
        const { purgeOlderThan30Days } = await import("../services/trashService.js");
        const { deletedCount } = await purgeOlderThan30Days();
        logger.log(`✅ [CRON] Purge corbeille terminée: ${deletedCount} page(s) supprimée(s)`);
      } catch (error) {
        logger.error("❌ [CRON] Erreur lors de la purge corbeille:", error);
      } finally {
        clearInterval(refreshHandle);
        await redis.del(lockKey).catch((err: unknown) => {
          logger.warn("[CRON] Failed to release trashPurge lock:", err);
        });
      }
    },
    {
      timezone: "Europe/Paris",
    },
  );

  logger.log(`✅ Tâche purge corbeille programmée: ${TRASH_PURGE_SCHEDULE} (Europe/Paris)`);

  // ─── Beta Management Cron Jobs ──────────────────────────────

  let betaCheckInactiveTask: ReturnType<typeof cron.schedule> | undefined;
  let betaWeeklyResetTask: ReturnType<typeof cron.schedule> | undefined;
  let betaProcessWaitlistTask: ReturnType<typeof cron.schedule> | undefined;
  let betaCleanupExpiredTask: ReturnType<typeof cron.schedule> | undefined;
  let betaPositionUpdatesTask: ReturnType<typeof cron.schedule> | undefined;

  if (BETA_LIVE) {
    // 🔍 Désactivation des utilisateurs inactifs (pas de heartbeat depuis 7 jours)
    betaCheckInactiveTask = cron.schedule(
      BETA_CHECK_INACTIVE_SCHEDULE,
      async () => {
        logger.log("\n🔍 [CRON] Beta: vérification des utilisateurs inactifs...");
        try {
          const { BetaCronService } = await import("../services/BetaCronService.js");

          const result = await BetaCronService.checkInactiveUsers();

          logger.log(`✅ [CRON] Beta inactive check: ${result.processed} désactivés`);
        } catch (error) {
          logger.error("❌ [CRON] Erreur beta inactive check:", error);
        }
      },
      {
        timezone: "UTC",
      },
    );

    logger.log(`✅ Tâche beta inactive check programmée: ${BETA_CHECK_INACTIVE_SCHEDULE} (UTC)`);

    // 🔄 Reset hebdomadaire des compteurs beta (lundi 00:00 UTC)
    betaWeeklyResetTask = cron.schedule(
      BETA_WEEKLY_RESET_SCHEDULE,
      async () => {
        logger.log("\n🔄 [CRON] Beta: reset hebdomadaire des compteurs...");
        try {
          const { BetaCronService } = await import("../services/BetaCronService.js");

          const result = await BetaCronService.resetWeeklyCounters();

          logger.log(`✅ [CRON] Beta weekly reset: ${result.processed} users reset`);
        } catch (error) {
          logger.error("❌ [CRON] Erreur beta weekly reset:", error);
        }
      },
      {
        timezone: "UTC",
      },
    );

    logger.log(`✅ Tâche beta weekly reset programmée: ${BETA_WEEKLY_RESET_SCHEDULE} (UTC)`);

    // 📋 Promotion automatique depuis la waitlist
    betaProcessWaitlistTask = cron.schedule(
      BETA_PROCESS_WAITLIST_SCHEDULE,
      async () => {
        logger.log("\n📋 [CRON] Beta: traitement de la waitlist...");
        try {
          const { BetaCronService } = await import("../services/BetaCronService.js");

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
    betaCleanupExpiredTask = cron.schedule(
      BETA_CLEANUP_EXPIRED_SCHEDULE,
      async () => {
        logger.log("\n🗑️ [CRON] Beta: nettoyage des comptes expirés...");
        try {
          const { BetaCronService } = await import("../services/BetaCronService.js");

          const result = await BetaCronService.cleanupExpiredAccounts();

          logger.log(`✅ [CRON] Beta cleanup: ${result.processed} comptes expirés`);
        } catch (error) {
          logger.error("❌ [CRON] Erreur beta cleanup:", error);
        }
      },
      {
        timezone: "UTC",
      },
    );

    logger.log(`✅ Tâche beta cleanup programmée: ${BETA_CLEANUP_EXPIRED_SCHEDULE} (UTC)`);

    // 📊 Envoi des emails de progression waitlist (toutes les 10 positions)
    betaPositionUpdatesTask = cron.schedule(
      BETA_POSITION_UPDATES_SCHEDULE,
      async () => {
        logger.log("\n📊 [CRON] Beta: envoi des mises à jour de position waitlist...");
        try {
          const { BetaCronService } = await import("../services/BetaCronService.js");

          const result = await BetaCronService.sendPositionUpdates();

          logger.log(
            `✅ [CRON] Beta position updates: ${result.processed} notifiés, ${result.errors} erreurs`,
          );
        } catch (error) {
          logger.error("❌ [CRON] Erreur beta position updates:", error);
        }
      },
      {
        timezone: "UTC",
      },
    );

    logger.log(
      `✅ Tâche beta position updates programmée: ${BETA_POSITION_UPDATES_SCHEDULE} (UTC)`,
    );
  } else {
    logger.log("⏸️ Beta management cron jobs désactivés (BETA_LIVE = false)");
  }

  // 📧 Retry pending emails that failed due to rate limits
  const emailRetryTask = cron.schedule(
    "45 * * * *", // :45 — retry pending emails every hour
    async () => {
      logger.log("\n📧 [CRON] Retry pending emails...");
      try {
        const { retryPendingEmails } = await import("../services/EmailService.js");
        const result = await retryPendingEmails();
        logger.log(
          `✅ [CRON] Email retry: ${result.sent} sent, ${result.failed} failed, ${result.dropped} dropped, ${result.remaining} remaining`,
        );
      } catch (error) {
        logger.error("❌ [CRON] Erreur email retry:", error);
      }
    },
    { timezone: "UTC" },
  );

  logger.log("✅ Tâche email retry programmée: 45 * * * * (UTC)");

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

  const tasks = [
    healthCheckTask,
    ragCleanupTask,
    monthlyResetTask,
    dailyLimitsResetTask,
    trashPurgeTask,
    emailRetryTask,
    ...(BETA_LIVE
      ? [
          betaCheckInactiveTask,
          betaWeeklyResetTask,
          betaProcessWaitlistTask,
          betaCleanupExpiredTask,
          betaPositionUpdatesTask,
        ]
      : []),
  ].filter((t): t is ReturnType<typeof cron.schedule> => t != null);

  // Stocker les tâches pour pouvoir les arrêter proprement
  activeTasks.push(...tasks);

  return {
    healthCheck: healthCheckTask,
    ragCleanup: ragCleanupTask,
    monthlyReset: monthlyResetTask,
    dailyLimitsReset: dailyLimitsResetTask,
    trashPurge: trashPurgeTask,
    ...(BETA_LIVE
      ? {
          betaCheckInactive: betaCheckInactiveTask,
          betaWeeklyReset: betaWeeklyResetTask,
          betaProcessWaitlist: betaProcessWaitlistTask,
          betaCleanupExpired: betaCleanupExpiredTask,
          betaPositionUpdates: betaPositionUpdatesTask,
        }
      : {}),
  };
}

// Référence vers les tâches actives pour le shutdown
const activeTasks: ReturnType<typeof cron.schedule>[] = [];

export function stopCronJobs() {
  logger.log(`🛑 Arrêt de ${activeTasks.length} tâches CRON...`);
  for (const task of activeTasks) {
    task.stop();
  }
  activeTasks.length = 0;
  logger.log("✅ Tâches CRON arrêtées");
}

// Gestion propre des signaux de fermeture
process.on("SIGTERM", stopCronJobs);
process.on("SIGINT", stopCronJobs);
