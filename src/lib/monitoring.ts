/**
 * 📊 MONITORING ET MÉTRIQUES
 *
 * Monitoring de la santé du serveur :
 * - Utilisation RAM (notamment pour Yjs documents)
 * - Utilisation CPU
 * - Statistiques des queues BullMQ
 * - Connection pool database
 */

import { logger } from "../utils/logger.js";
import { getQueueStats } from "./queues.js";

/**
 * 💾 Métriques RAM et mémoire
 */
export const getMemoryStats = () => {
  const used = process.memoryUsage();

  return {
    rss: {
      value: used.rss,
      mb: Math.round((used.rss / 1024 / 1024) * 100) / 100,
      label: "Resident Set Size",
    },
    heapTotal: {
      value: used.heapTotal,
      mb: Math.round((used.heapTotal / 1024 / 1024) * 100) / 100,
      label: "Total Heap",
    },
    heapUsed: {
      value: used.heapUsed,
      mb: Math.round((used.heapUsed / 1024 / 1024) * 100) / 100,
      label: "Heap Used",
    },
    external: {
      value: used.external,
      mb: Math.round((used.external / 1024 / 1024) * 100) / 100,
      label: "External (C++ objects)",
    },
  };
};

/**
 * 🖥️ Métriques CPU
 */
export const getCpuStats = () => {
  const usage = process.cpuUsage();

  return {
    user: {
      value: usage.user,
      ms: Math.round(usage.user / 1000),
      label: "User CPU Time",
    },
    system: {
      value: usage.system,
      ms: Math.round(usage.system / 1000),
      label: "System CPU Time",
    },
  };
};

/**
 * ⏱️ Métriques d'uptime
 */
export const getUptimeStats = () => {
  const uptime = process.uptime();

  return {
    seconds: uptime,
    formatted: formatUptime(uptime),
  };
};

/**
 * 📊 Métriques globales du système
 */
export const getSystemStats = async () => {
  const memory = getMemoryStats();
  const cpu = getCpuStats();
  const uptime = getUptimeStats();
  const queues = await getQueueStats();

  return {
    timestamp: new Date().toISOString(),
    memory,
    cpu,
    uptime,
    queues,
    pid: process.pid,
    nodeVersion: process.version,
  };
};

/**
 * 🚨 Détecter les seuils critiques
 *
 * Configuration pour Railway Hobby Plan (8GB RAM disponible)
 * Heap Node.js configurée à 2GB (--max-old-space-size=2048)
 */
export const checkHealthThresholds = () => {
  const memory = getMemoryStats();
  const heapUsedPercent =
    (memory.heapUsed.value / memory.heapTotal.value) * 100;

  const warnings = [];

  // RAM Heap > 85% (seuil augmenté pour 2GB)
  if (heapUsedPercent > 85) {
    warnings.push({
      level: "critical",
      type: "memory",
      message: `Heap usage critique: ${Math.round(heapUsedPercent)}% (${memory.heapUsed.mb}MB/${memory.heapTotal.mb}MB)`,
    });
  } else if (heapUsedPercent > 70) {
    warnings.push({
      level: "warning",
      type: "memory",
      message: `Heap usage élevé: ${Math.round(heapUsedPercent)}% (${memory.heapUsed.mb}MB/${memory.heapTotal.mb}MB)`,
    });
  }

  // RSS > 4GB (Railway Hobby = 8GB total, laisser 50% de marge)
  if (memory.rss.mb > 4096) {
    warnings.push({
      level: "critical",
      type: "memory",
      message: `RSS critique: ${memory.rss.mb}MB (limite Railway Hobby: 8GB)`,
    });
  } else if (memory.rss.mb > 3072) {
    warnings.push({
      level: "warning",
      type: "memory",
      message: `RSS élevé: ${memory.rss.mb}MB (documents Yjs ou cache Redis importants)`,
    });
  }

  return {
    healthy: warnings.filter((w) => w.level === "critical").length === 0,
    warnings,
  };
};

/**
 * 📈 Monitoring automatique avec logs périodiques
 */
let monitoringInterval: NodeJS.Timeout | null = null;

export const startMonitoring = (intervalMinutes: number = 5) => {
  if (monitoringInterval) {
    logger.warn("⚠️ [MONITORING] Monitoring déjà actif");
    return;
  }

  logger.log(
    `📊 [MONITORING] Démarrage monitoring (intervalle: ${intervalMinutes}min)`,
  );

  monitoringInterval = setInterval(
    async () => {
      const stats = await getSystemStats();
      const health = checkHealthThresholds();

      logger.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      );
      logger.log("📊 [MONITORING] Métriques système");
      logger.log(
        `   💾 Heap: ${stats.memory.heapUsed.mb}MB / ${stats.memory.heapTotal.mb}MB (${Math.round((stats.memory.heapUsed.value / stats.memory.heapTotal.value) * 100)}%)`,
      );
      logger.log(`   📦 RSS: ${stats.memory.rss.mb}MB`);
      logger.log(`   ⏱️ Uptime: ${stats.uptime.formatted}`);
      logger.log(`   🎯 Queues:`);
      logger.log(
        `      - AI Generation: ${stats.queues?.aiGeneration?.waiting ?? 0} waiting, ${stats.queues?.aiGeneration?.active ?? 0} active`,
      );
      logger.log(
        `      - AI Quiz: ${stats.queues?.aiQuiz?.waiting ?? 0} waiting, ${stats.queues?.aiQuiz?.active ?? 0} active`,
      );
      logger.log(
        `      - Futura: ${stats.queues?.futura?.waiting ?? 0} waiting, ${stats.queues?.futura?.active ?? 0} active`,
      );

      if (health.warnings.length > 0) {
        logger.log("   ⚠️ Avertissements:");
        health.warnings.forEach((w) => {
          const icon = w.level === "critical" ? "🚨" : "⚠️";
          logger.log(`      ${icon} ${w.message}`);
        });
      }

      logger.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      );
    },
    intervalMinutes * 60 * 1000,
  );
};

export const stopMonitoring = () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    logger.log("📊 [MONITORING] Monitoring arrêté");
  }
};

/**
 * 🔧 Helpers
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}j ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
