/**
 * 🎯 BULLMQ QUEUE CONFIGURATION
 *
 * Configuration centralisée pour toutes les queues de traitement asynchrone.
 * Utilise Redis pour la persistance et la distribution des jobs.
 *
 * Queues disponibles:
 * - ai-generation: Génération de contenu AI (texte, plans, idées)
 * - ai-assistant: Traitement assistant (ask, search, create)
 * - ai-quiz: Génération de quiz AI
 */

import { Queue, QueueOptions } from "bullmq";
import { redis } from "./redis.js";

// ⚙️ Configuration commune pour toutes les queues
const defaultQueueOptions: QueueOptions = {
  connection: redis, // Réutiliser la connexion Redis existante
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

// 🤖 Queue pour assistant AI (1-2 crédits)
export const aiAssistantQueue = new Queue("ai-assistant", {
  ...defaultQueueOptions,
  defaultJobOptions: {
    ...defaultQueueOptions.defaultJobOptions,
    priority: 7, // Priorité plus haute (interaction utilisateur)
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

// 📊 Logging de la configuration
console.log("🎯 [QUEUES] Queues BullMQ initialisées:");
console.log("   - ai-generation (priorité: 5)");
console.log("   - ai-assistant (priorité: 7)");
console.log("   - ai-quiz (priorité: 5)");
console.log("   - futura (priorité: 3)");

// 🔧 Fonctions utilitaires pour monitoring
export const getQueueStats = async () => {
  const [genCounts, assistantCounts, quizCounts, futuraCounts] =
    await Promise.all([
      aiGenerationQueue.getJobCounts(),
      aiAssistantQueue.getJobCounts(),
      aiQuizQueue.getJobCounts(),
      futuraQueue.getJobCounts(),
    ]);

  return {
    aiGeneration: genCounts,
    aiAssistant: assistantCounts,
    aiQuiz: quizCounts,
    futura: futuraCounts,
  };
};

// 🧹 Cleanup gracieux lors de l'arrêt du serveur
export const closeQueues = async () => {
  console.log("🧹 [QUEUES] Fermeture des queues...");
  await Promise.all([
    aiGenerationQueue.close(),
    aiAssistantQueue.close(),
    aiQuizQueue.close(),
    futuraQueue.close(),
  ]);
  console.log("✅ [QUEUES] Queues fermées");
};
