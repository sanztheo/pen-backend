/**
 * 🎯 WORKER MANAGER
 *
 * Point d'entrée centralisé pour tous les workers BullMQ.
 * Gère le démarrage, l'arrêt et le monitoring des workers.
 */

import { logger } from "../utils/logger.js";
import { quizWorker } from "./quiz.worker.js";

import { exportWorker } from "./export.worker.js";

// 📊 Liste de tous les workers actifs
const workers = [quizWorker, exportWorker];

// 🚀 Démarrer tous les workers
export const startWorkers = () => {
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.log("🎯 Démarrage des workers BullMQ...");
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  workers.forEach((worker) => {
    logger.log(`✅ Worker "${worker.name}" actif`);
  });

  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
};

// 🧹 Arrêter tous les workers proprement
export const stopWorkers = async () => {
  logger.log("🧹 [WORKERS] Arrêt des workers...");

  await Promise.all(workers.map((worker) => worker.close()));

  logger.log("✅ [WORKERS] Tous les workers arrêtés");
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
export { quizWorker, exportWorker };
