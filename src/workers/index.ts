/**
 * 🎯 WORKER MANAGER
 *
 * Point d'entrée centralisé pour tous les workers BullMQ.
 * Gère le démarrage, l'arrêt et le monitoring des workers.
 */

import { aiGenerationWorker } from "./ai.worker.js";
import { assistantWorker } from "./assistant.worker.js";
import { quizWorker } from "./quiz.worker.js";

// 📊 Liste de tous les workers actifs
const workers = [aiGenerationWorker, assistantWorker, quizWorker];

// 🚀 Démarrer tous les workers
export const startWorkers = () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎯 Démarrage des workers BullMQ...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  workers.forEach((worker) => {
    console.log(`✅ Worker "${worker.name}" actif`);
  });

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
};

// 🧹 Arrêter tous les workers proprement
export const stopWorkers = async () => {
  console.log("🧹 [WORKERS] Arrêt des workers...");

  await Promise.all(workers.map((worker) => worker.close()));

  console.log("✅ [WORKERS] Tous les workers arrêtés");
};

// 📊 Obtenir le statut de tous les workers
export const getWorkersStats = async () => {
  const stats = await Promise.all(
    workers.map(async (worker) => ({
      name: worker.name,
      isRunning: await worker.isRunning(),
      isPaused: await worker.isPaused(),
    })),
  );

  return stats;
};

// 🎯 Exporter les workers individuellement si besoin
export { aiGenerationWorker, assistantWorker, quizWorker };
