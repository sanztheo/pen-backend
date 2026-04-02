/**
 * Retention Cohorts CRON Job
 * Computes retention cohorts every Sunday at midnight.
 */

import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { RetentionCohortService } from "../services/admin/retentionCohortService.js";

let retentionTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the retention cohorts CRON job (every Sunday at midnight).
 */
export function startRetentionCron(): void {
  if (retentionTask) {
    logger.warn("[RETENTION_CRON] Already running, skipping duplicate start");
    return;
  }

  retentionTask = cron.schedule("0 0 * * 0", async () => {
    try {
      const { redis } = await import("../lib/redis.js");
      const lockKey = "cron:lock:retentionCohorts";
      const acquired = await redis.set(lockKey, "1", "EX", 3600, "NX");
      if (!acquired) {
        logger.log("[RETENTION_CRON] Lock already held, skipping");
        return;
      }

      try {
        await RetentionCohortService.computeAndStoreCohorts();
      } finally {
        await redis.del(lockKey).catch((err: unknown) => {
          logger.warn("[RETENTION_CRON] Failed to release lock:", err);
        });
      }
    } catch (error) {
      logger.error("[RETENTION_CRON] Unhandled error in cohort computation:", error);
    }
  });

  logger.log("[RETENTION_CRON] Started — runs every Sunday at midnight");
}

/**
 * Stop the retention CRON job.
 */
export function stopRetentionCron(): void {
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
    logger.log("[RETENTION_CRON] Stopped");
  }
}
