/**
 * 🎯 JOB RESULTS MANAGER
 *
 * Gère le stockage et la récupération des résultats de jobs BullMQ via Redis.
 * Permet aux endpoints de retourner immédiatement un jobId et aux clients
 * de récupérer le résultat plus tard.
 *
 * 🛡️ SÉCURITÉ: Les jobs sont associés à un userId pour empêcher l'accès
 * aux résultats d'autres utilisateurs (IDOR protection).
 */

import { logger } from "../utils/logger.js";
import { redis } from "./redis.js";
import { z } from "zod";

const JOB_RESULT_TTL = 300; // 5 minutes - temps pour récupérer le résultat
const JOB_RESULT_PREFIX = "job-result:";

export interface JobResult<T = unknown> {
  status: "pending" | "completed" | "failed";
  result?: T;
  error?: string;
  progress?: number;
  createdAt: Date;
  completedAt?: Date;
  userId?: string; // 🛡️ SÉCURITÉ: Ownership du job
}

const JobResultSchema = z.object({
  status: z.enum(["pending", "completed", "failed"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  progress: z.number().optional(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  userId: z.string().optional(),
}).passthrough();

type ParsedJobResult = z.infer<typeof JobResultSchema>;

function parseJobResult(raw: string): ParsedJobResult | null {
  try {
    const parsedUnknown: unknown = JSON.parse(raw);
    const parsed = JobResultSchema.safeParse(parsedUnknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * 🛡️ Générer une clé sécurisée incluant le userId
 * Format: job-result:{userId}:{jobId}
 */
const getSecureKey = (userId: string, jobId: string): string => {
  return `${JOB_RESULT_PREFIX}${userId}:${jobId}`;
};

/**
 * 🛡️ Générer une clé legacy (sans userId) pour compatibilité
 */
const getLegacyKey = (jobId: string): string => {
  return `${JOB_RESULT_PREFIX}${jobId}`;
};

/**
 * 🛡️ Stocker le résultat d'un job dans Redis avec userId
 * @param jobId - ID unique du job
 * @param userId - ID de l'utilisateur propriétaire du job
 * @param result - Résultat du job
 */
export const storeJobResult = async <T = unknown>(
  jobId: string,
  userId: string,
  result: JobResult<T>,
): Promise<void> => {
  try {
    // 🛡️ Stocker avec clé sécurisée incluant userId
    const key = getSecureKey(userId, jobId);
    const resultWithOwnership = { ...result, userId };
    await redis.setex(key, JOB_RESULT_TTL, JSON.stringify(resultWithOwnership));
    logger.log(
      `✅ [JOB-RESULTS] Résultat stocké: ${jobId} pour user ${userId} (status: ${result.status})`,
    );
  } catch (error) {
    logger.error(`❌ [JOB-RESULTS] Erreur stockage: ${jobId}`, error);
    throw error;
  }
};

/**
 * 🛡️ Récupérer le résultat d'un job depuis Redis avec vérification d'ownership
 * @param jobId - ID unique du job
 * @param userId - ID de l'utilisateur demandeur (pour vérification)
 * @returns Le résultat du job si l'utilisateur est propriétaire, null sinon
 */
export const getJobResult = async <T>(
  jobId: string,
  userId: string,
  resultSchema: z.ZodType<T>,
): Promise<JobResult<T> | null> => {
  try {
    // 🛡️ Chercher d'abord avec la clé sécurisée
    const secureKey = getSecureKey(userId, jobId);
    let data = await redis.get(secureKey);

    // 🔄 Fallback: chercher dans l'ancien format pour compatibilité
    // (jobs créés avant la migration de sécurité)
    if (!data) {
      const legacyKey = getLegacyKey(jobId);
      data = await redis.get(legacyKey);

      if (data) {
        const legacyResult = parseJobResult(data);
        if (!legacyResult) {
          return null;
        }
        // 🛡️ Vérifier que le job legacy appartient bien à l'utilisateur
        if (legacyResult.userId && legacyResult.userId !== userId) {
          logger.warn(
            `🚨 [JOB-RESULTS] ACCÈS REFUSÉ: userId=${userId} tente d'accéder au job ${jobId} appartenant à ${legacyResult.userId}`,
          );
          return null;
        }
        // Si pas de userId stocké (très ancien job), on accepte pour compatibilité
        // mais on log un warning
        if (!legacyResult.userId) {
          logger.warn(
            `⚠️ [JOB-RESULTS] Job legacy sans userId: ${jobId} - accès autorisé par défaut`,
          );
        }
      }
    }

    if (!data) {
      logger.log(`❌ [JOB-RESULTS] Résultat non trouvé: ${jobId}`);
      return null;
    }

    const base = parseJobResult(data);
    if (!base) return null;

    const parsedResult =
      base.result === undefined ? undefined : resultSchema.safeParse(base.result);
    const typedResult: JobResult<T> = {
      ...base,
      result: parsedResult && parsedResult.success ? parsedResult.data : undefined,
    };

    logger.log(
      `✅ [JOB-RESULTS] Résultat récupéré: ${jobId} (status: ${typedResult.status})`,
    );
    return typedResult;
  } catch (error) {
    logger.error(`❌ [JOB-RESULTS] Erreur récupération: ${jobId}`, error);
    return null;
  }
};

/**
 * 🛡️ Marquer un job comme en cours
 */
export const markJobPending = async (
  jobId: string,
  userId: string,
): Promise<void> => {
  await storeJobResult(jobId, userId, {
    status: "pending",
    createdAt: new Date(),
  });
};

/**
 * 🛡️ Marquer un job comme complété avec son résultat
 */
export const markJobCompleted = async <T = unknown>(
  jobId: string,
  userId: string,
  result: T,
): Promise<void> => {
  await storeJobResult(jobId, userId, {
    status: "completed",
    result,
    createdAt: new Date(),
    completedAt: new Date(),
  });
};

/**
 * 🛡️ Marquer un job comme échoué avec une erreur
 */
export const markJobFailed = async (
  jobId: string,
  userId: string,
  error: string,
): Promise<void> => {
  await storeJobResult(jobId, userId, {
    status: "failed",
    error,
    createdAt: new Date(),
    completedAt: new Date(),
  });
};

/**
 * 🛡️ Supprimer un résultat de job avec vérification d'ownership
 */
export const deleteJobResult = async (
  jobId: string,
  userId: string,
): Promise<void> => {
  try {
    // Supprimer la clé sécurisée
    const secureKey = getSecureKey(userId, jobId);
    await redis.del(secureKey);

    // 🔄 Aussi supprimer la clé legacy si elle existe (nettoyage)
    const legacyKey = getLegacyKey(jobId);
    const legacyData = await redis.get(legacyKey);
    if (legacyData) {
      const legacyResult = parseJobResult(legacyData);
      // Ne supprimer que si c'est le bon propriétaire ou pas de propriétaire
      if (!legacyResult?.userId || legacyResult.userId === userId) {
        await redis.del(legacyKey);
      }
    }

    logger.log(`🗑️ [JOB-RESULTS] Résultat supprimé: ${jobId}`);
  } catch (error) {
    logger.error(`❌ [JOB-RESULTS] Erreur suppression: ${jobId}`, error);
  }
};
