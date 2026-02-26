/**
 * EXPORT WORKER
 *
 * Worker pour traiter les jobs d'export CSV en arrière-plan.
 * Stocke le CSV généré dans Redis pour téléchargement ultérieur.
 *
 * Jobs traités:
 * - admin-user-export: Export CSV des utilisateurs
 */

import { logger } from "../utils/logger.js";
import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { markJobCompleted, markJobFailed } from "../lib/jobResults.js";
import { AdminExportService } from "../services/admin/adminExportService.js";
import { prisma } from "../lib/prisma.js";
import { AdminExportJobData, AdminExportJobResult } from "../types/admin.types.js";

const CSV_RESULT_TTL = 300; // 5 minutes
const CSV_KEY_PREFIX = "csv-export:";

function getCSVKey(userId: string, jobId: string): string {
  return `${CSV_KEY_PREFIX}${userId}:${jobId}`;
}

async function processExportJob(job: Job<AdminExportJobData>): Promise<AdminExportJobResult> {
  const { type, userId, adminEmail, filters } = job.data;
  const startTime = Date.now();

  logger.log(`[EXPORT-WORKER] Processing ${type} for admin ${adminEmail}`);

  if (type !== "admin-user-export") {
    logger.error(`[EXPORT-WORKER] Unknown export type: ${type}`);
    return { success: false, error: `Unknown export type: ${type}` };
  }

  try {
    const { csv, rowCount } = await AdminExportService.generateUserCSV(filters, adminEmail);

    const csvKey = getCSVKey(userId, job.id!);
    await redis.setex(csvKey, CSV_RESULT_TTL, csv);

    const durationMs = Date.now() - startTime;
    logger.log(`[EXPORT-WORKER] Export completed: ${rowCount} rows in ${durationMs}ms`);

    return { success: true, downloadKey: csvKey, rowCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(`[EXPORT-WORKER] Export failed:`, message);
    return { success: false, error: message };
  }
}

export const exportWorker = new Worker<AdminExportJobData, AdminExportJobResult>(
  "admin-export",
  processExportJob,
  {
    connection: redis as unknown as import("bullmq").ConnectionOptions,
    concurrency: 2,
    limiter: { max: 20, duration: 60000 },
  },
);

exportWorker.on("completed", async (job, result) => {
  logger.log(`[EXPORT-WORKER] Job ${job.id} completed`);

  if (!job.id || !job.data.userId) return;

  await markJobCompleted(job.id, job.data.userId, result);

  try {
    await prisma.activityLog.create({
      data: {
        userId: job.data.userId,
        action: "ADMIN_EXPORT_USERS_COMPLETED",
        entityType: "export",
        entityId: job.id,
        details: JSON.parse(
          JSON.stringify({
            rowCount: result.rowCount,
            filters: job.data.filters,
          }),
        ),
      },
    });
  } catch (logError) {
    logger.error("[EXPORT-WORKER] Failed to create ActivityLog:", logError);
  }
});

exportWorker.on("failed", async (job, error) => {
  logger.error(`[EXPORT-WORKER] Job ${job?.id} failed:`, error.message);

  if (job?.id && job?.data.userId) {
    await markJobFailed(job.id, job.data.userId, error.message);
  }
});

exportWorker.on("error", (error) => {
  logger.error("[EXPORT-WORKER] Worker error:", error);
});

logger.log("[EXPORT-WORKER] Worker initialized");

export async function getExportCSV(userId: string, jobId: string): Promise<string | null> {
  return redis.get(getCSVKey(userId, jobId));
}

export async function deleteExportCSV(userId: string, jobId: string): Promise<void> {
  await redis.del(getCSVKey(userId, jobId));
}
