/**
 * 🎯 BULLMQ QUEUE CONFIGURATION
 *
 * Configuration centralisée pour toutes les queues de traitement asynchrone.
 * Utilise Redis pour la persistance et la distribution des jobs.
 *
 * Queues disponibles:
 * - ai-generation: Génération de contenu AI (texte, plans, idées)
 * - ai-quiz: Génération de quiz AI
 * - futura: Articles scientifiques
 */

import { logger } from "../utils/logger.js";
import { Queue, QueueOptions } from "bullmq";
import { redis } from "./redis.js";

// ⚙️ Configuration commune pour toutes les queues
const defaultQueueOptions: QueueOptions = {
  connection: redis as unknown as import("bullmq").ConnectionOptions, // Cast nécessaire: versions ioredis différentes entre top-level et bullmq
  defaultJobOptions: {
    attempts: 3, // 3 tentatives en cas d'échec
    backoff: {
      type: "exponential",
      delay: 2000, // Démarrer avec 2s, puis 4s, 8s
    },
    removeOnComplete: {
      age: 3600, // Supprimer les jobs complétés après 1h
      count: 1000, // Garder max 1000 jobs complétés
    },
    removeOnFail: {
      age: 86400, // Garder les échecs 24h pour debug
    },
  },
};

// 🎨 Queue pour génération de contenu AI (0.3-0.5 crédits)
export const aiGenerationQueue = new Queue("ai-generation", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    priority: 5, // Priorité normale
  },
});

// 📝 Queue pour génération de quiz AI
export const aiQuizQueue = new Queue("ai-quiz", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    priority: 5,
  },
});

// 📰 Queue pour articles scientifiques Futura
export const futuraQueue = new Queue("futura", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    priority: 3, // Priorité basse (tâche en arrière-plan)
    removeOnComplete: {
      age: 86400, // Garder les jobs complétés 24h
      count: 100,
    },
  },
});

// 📊 Queue pour exports admin (CSV)
export const adminExportQueue = new Queue("admin-export", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    priority: 2, // Priorité basse (tâche en arrière-plan)
    removeOnComplete: {
      age: 3600, // Garder les jobs complétés 1h
      count: 100,
    },
  },
});

// 📊 Logging de la configuration
logger.log("🎯 [QUEUES] Queues BullMQ initialisées:");
logger.log("   - ai-generation (priorité: 5)");
logger.log("   - ai-quiz (priorité: 5)");
logger.log("   - futura (priorité: 3)");
logger.log("   - admin-export (priorité: 2)");

// 🔧 Fonctions utilitaires pour monitoring
export const getQueueStats = async () => {
  const [genCounts, quizCounts, futuraCounts, exportCounts] = await Promise.all([
    aiGenerationQueue.getJobCounts(),
    aiQuizQueue.getJobCounts(),
    futuraQueue.getJobCounts(),
    adminExportQueue.getJobCounts(),
  ]);

  return {
    aiGeneration: genCounts,
    aiQuiz: quizCounts,
    futura: futuraCounts,
    adminExport: exportCounts,
  };
};

// 🧹 Cleanup gracieux lors de l'arrêt du serveur
export const closeQueues = async () => {
  logger.log("🧹 [QUEUES] Fermeture des queues...");
  await Promise.all([
    aiGenerationQueue.close(),
    aiQuizQueue.close(),
    futuraQueue.close(),
    adminExportQueue.close(),
  ]);
  logger.log("✅ [QUEUES] Queues fermées");
};
