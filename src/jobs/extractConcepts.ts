/**
 * 🧠 BullMQ Job - Extraction des concepts en background
 * PEN-15: Permet l'extraction asynchrone des concepts de pages
 */

import { Queue, Worker, Job } from "bullmq";
import { ConceptExtractorService } from "../services/quiz/intelligence/index.js";

// Configuration Redis depuis les variables d'environnement
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL manquant dans les variables d'environnement");
  }

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
  };
};

// Nom de la queue
const QUEUE_NAME = "concept-extraction";

// Types pour le job
export interface ExtractConceptsJobData {
  pageId: string;
  forceRefresh?: boolean;
  priority?: "low" | "normal" | "high";
}

// Queue singleton (lazy init)
let queue: Queue<ExtractConceptsJobData> | null = null;

/**
 * Obtient la queue d'extraction (lazy initialization)
 */
export function getConceptExtractionQueue(): Queue<ExtractConceptsJobData> {
  if (!queue) {
    queue = new Queue<ExtractConceptsJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 100, // Garder les 100 derniers jobs terminés
        removeOnFail: 50, // Garder les 50 derniers échecs
      },
    });
    console.log(`📋 [ConceptQueue] Queue "${QUEUE_NAME}" initialisée`);
  }
  return queue;
}

/**
 * Ajoute un job d'extraction pour une page
 */
export async function enqueueConceptExtraction(
  pageId: string,
  options: {
    forceRefresh?: boolean;
    priority?: "low" | "normal" | "high";
  } = {},
): Promise<Job<ExtractConceptsJobData>> {
  const queue = getConceptExtractionQueue();

  const priorityMap = { low: 10, normal: 5, high: 1 };
  const priority = priorityMap[options.priority || "normal"];

  const job = await queue.add(
    "extract-single",
    {
      pageId,
      forceRefresh: options.forceRefresh || false,
      priority: options.priority || "normal",
    },
    { priority },
  );

  console.log(`📋 [ConceptQueue] Job ajouté: ${job.id} pour page ${pageId}`);
  return job;
}

/**
 * Ajoute un job batch pour plusieurs pages
 * Note: Utilise la même queue mais avec des jobs individuels pour éviter les problèmes de types
 */
export async function enqueueConceptExtractionBatch(
  pageIds: string[],
  options: { forceRefresh?: boolean } = {},
): Promise<Job<ExtractConceptsJobData>[]> {
  const queue = getConceptExtractionQueue();

  const jobs = await Promise.all(
    pageIds.map((pageId) =>
      queue.add(
        "extract-single",
        {
          pageId,
          forceRefresh: options.forceRefresh || false,
          priority: "normal",
        },
        { priority: 5 },
      ),
    ),
  );

  console.log(
    `📋 [ConceptQueue] Batch de ${jobs.length} jobs ajoutés pour ${pageIds.length} pages`,
  );
  return jobs;
}

/**
 * Worker pour traiter les jobs d'extraction
 */
let worker: Worker | null = null;

export function startConceptExtractionWorker(): Worker {
  if (worker) {
    console.log(`⚠️ [ConceptWorker] Worker déjà démarré`);
    return worker;
  }

  worker = new Worker<ExtractConceptsJobData>(
    QUEUE_NAME,
    async (job: Job<ExtractConceptsJobData>) => {
      console.log(`🔄 [ConceptWorker] Traitement job ${job.id}: ${job.name}`);

      const { pageId, forceRefresh } = job.data;
      const result = await ConceptExtractorService.extractAndStore(pageId, {
        forceRefresh,
      });

      if (!result.success) {
        throw new Error(result.error || "Extraction échouée");
      }

      return {
        success: true,
        pageId,
        processingTimeMs: result.processingTimeMs,
      };
    },
    {
      connection: getRedisConnection(),
      concurrency: 2, // 2 jobs en parallèle max (API rate limiting)
    },
  );

  worker.on("completed", (job) => {
    console.log(`✅ [ConceptWorker] Job ${job.id} terminé`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ [ConceptWorker] Job ${job?.id} échoué:`, err.message);
  });

  console.log(`🚀 [ConceptWorker] Worker démarré (concurrency: 2)`);
  return worker;
}

/**
 * Arrête le worker proprement
 */
export async function stopConceptExtractionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log(`🛑 [ConceptWorker] Worker arrêté`);
  }
}

/**
 * Ferme la queue proprement
 */
export async function closeConceptExtractionQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
    console.log(`🛑 [ConceptQueue] Queue fermée`);
  }
}
