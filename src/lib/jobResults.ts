/**
 * 🎯 JOB RESULTS MANAGER
 *
 * Gère le stockage et la récupération des résultats de jobs BullMQ via Redis.
 * Permet aux endpoints de retourner immédiatement un jobId et aux clients
 * de récupérer le résultat plus tard.
 */

import { redis } from "./redis.js";

const JOB_RESULT_TTL = 300; // 5 minutes - temps pour récupérer le résultat
const JOB_RESULT_PREFIX = "job-result:";

export interface JobResult<T = any> {
  status: "pending" | "completed" | "failed";
  result?: T;
  error?: string;
  progress?: number;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Stocker le résultat d'un job dans Redis
 */
export const storeJobResult = async <T = any>(
  jobId: string,
  result: JobResult<T>,
): Promise<void> => {
  try {
    const key = `${JOB_RESULT_PREFIX}${jobId}`;
    await redis.setex(key, JOB_RESULT_TTL, JSON.stringify(result));
    console.log(
      `✅ [JOB-RESULTS] Résultat stocké: ${jobId} (status: ${result.status})`,
    );
  } catch (error) {
    console.error(`❌ [JOB-RESULTS] Erreur stockage: ${jobId}`, error);
    throw error;
  }
};

/**
 * Récupérer le résultat d'un job depuis Redis
 */
export const getJobResult = async <T = any>(
  jobId: string,
): Promise<JobResult<T> | null> => {
  try {
    const key = `${JOB_RESULT_PREFIX}${jobId}`;
    const data = await redis.get(key);

    if (!data) {
      console.log(`❌ [JOB-RESULTS] Résultat non trouvé: ${jobId}`);
      return null;
    }

    const result = JSON.parse(data) as JobResult<T>;

    // Reconvertir les dates
    result.createdAt = new Date(result.createdAt);
    if (result.completedAt) {
      result.completedAt = new Date(result.completedAt);
    }

    console.log(
      `✅ [JOB-RESULTS] Résultat récupéré: ${jobId} (status: ${result.status})`,
    );
    return result;
  } catch (error) {
    console.error(`❌ [JOB-RESULTS] Erreur récupération: ${jobId}`, error);
    return null;
  }
};

/**
 * Marquer un job comme en cours
 */
export const markJobPending = async (jobId: string): Promise<void> => {
  await storeJobResult(jobId, {
    status: "pending",
    createdAt: new Date(),
  });
};

/**
 * Marquer un job comme complété avec son résultat
 */
export const markJobCompleted = async <T = any>(
  jobId: string,
  result: T,
): Promise<void> => {
  await storeJobResult(jobId, {
    status: "completed",
    result,
    createdAt: new Date(),
    completedAt: new Date(),
  });
};

/**
 * Marquer un job comme échoué avec une erreur
 */
export const markJobFailed = async (
  jobId: string,
  error: string,
): Promise<void> => {
  await storeJobResult(jobId, {
    status: "failed",
    error,
    createdAt: new Date(),
    completedAt: new Date(),
  });
};

/**
 * Supprimer un résultat de job (après récupération)
 */
export const deleteJobResult = async (jobId: string): Promise<void> => {
  try {
    const key = `${JOB_RESULT_PREFIX}${jobId}`;
    await redis.del(key);
    console.log(`🗑️ [JOB-RESULTS] Résultat supprimé: ${jobId}`);
  } catch (error) {
    console.error(`❌ [JOB-RESULTS] Erreur suppression: ${jobId}`, error);
  }
};
