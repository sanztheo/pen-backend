/**
 * 🗑️ EMPTY TRASH JOB (BullMQ)
 *
 * Purge asynchrone de toute la corbeille d'un workspace.
 * Utilisé quand emptyTrashSync dépasse EMPTY_SYNC_MAX (>500 pages) — au-delà,
 * la requête HTTP synchrone risque le timeout et on bascule sur ce worker.
 *
 * Stratégie:
 * - Boucle par batches de BATCH (1000) jusqu'à épuisement
 * - Cleanup embeddings (pgvector) avant suppression Postgres
 * - Audit log final avec nombre total supprimé
 */

import { Queue, Worker, Job } from "bullmq";
import { redis } from "../lib/redis.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";
import { cleanupEmbeddingsForPages } from "../services/trashService.js";

const QUEUE_NAME = "empty-trash";
const BATCH = 1000;
const INTER_BATCH_DELAY_MS = 50;

interface EmptyTrashJobData {
  workspaceId: string;
}

interface EmptyTrashJobResult {
  deletedCount: number;
}

const connection = redis as unknown as import("bullmq").ConnectionOptions;

// 📨 Queue (enqueue depuis les routes /trash quand count > EMPTY_SYNC_MAX)
export const emptyTrashQueue = new Queue<EmptyTrashJobData, EmptyTrashJobResult>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

async function processEmptyTrashJob(job: Job<EmptyTrashJobData>): Promise<EmptyTrashJobResult> {
  const { workspaceId } = job.data;
  let totalDeleted = 0;
  let hasMore = true;

  logger.log(`[EMPTY-TRASH-WORKER] Starting empty-trash for workspace ${workspaceId}`);

  while (hasMore) {
    const batchIds = await prisma.page.findMany({
      where: { workspaceId, isArchived: true },
      select: { id: true },
      take: BATCH,
    });

    if (batchIds.length === 0) {
      hasMore = false;
      break;
    }

    const ids = batchIds.map((p) => p.id);
    await cleanupEmbeddingsForPages(ids);
    const result = await prisma.page.deleteMany({
      where: { id: { in: ids } },
    });

    totalDeleted += result.count;
    await job.updateProgress({ deleted: totalDeleted });

    if (batchIds.length < BATCH) {
      hasMore = false;
      break;
    }
    // Petite pause pour ne pas saturer le pool Postgres
    await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
  }

  logger.warn("[AUDIT] PAGE_PERMANENTLY_DELETED", {
    workspaceId,
    action: "empty_trash_async",
    totalDeleted,
  });

  return { deletedCount: totalDeleted };
}

// 👷 Worker
export const emptyTrashWorker = new Worker<EmptyTrashJobData, EmptyTrashJobResult>(
  QUEUE_NAME,
  processEmptyTrashJob,
  {
    connection,
    concurrency: 2,
  },
);

emptyTrashWorker.on("completed", (job, result) => {
  logger.log(`[EMPTY-TRASH-WORKER] Job ${job.id} completed: ${result.deletedCount} pages deleted`);
});

emptyTrashWorker.on("failed", (job, error) => {
  logger.error(`[EMPTY-TRASH-WORKER] Job ${job?.id} failed:`, error.message);
});

emptyTrashWorker.on("error", (error) => {
  logger.error("[EMPTY-TRASH-WORKER] Worker error:", error);
});
