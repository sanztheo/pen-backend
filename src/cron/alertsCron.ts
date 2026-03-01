/**
 * Alerts CRON Job
 * Runs alert checks every 5 minutes using node-cron.
 */

import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { AlertsService } from "../services/admin/alertsService.js";

let alertsTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Start the alerts CRON job (every 5 minutes).
 */
export function startAlertsCron(): void {
  if (alertsTask) {
    logger.warn("[ALERTS_CRON] Already running, skipping duplicate start");
    return;
  }

  alertsTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await AlertsService.runAllChecks();
    } catch (error) {
      logger.error("[ALERTS_CRON] Unhandled error in alert checks:", error);
    }
  });

  logger.log("[ALERTS_CRON] Started — runs every 5 minutes");
}

/**
 * Stop the alerts CRON job.
 */
export function stopAlertsCron(): void {
  if (alertsTask) {
    alertsTask.stop();
    alertsTask = null;
    logger.log("[ALERTS_CRON] Stopped");
  }
}
