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
      await RetentionCohortService.computeAndStoreCohorts();
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
