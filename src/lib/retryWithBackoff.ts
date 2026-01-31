/**
 * 🔄 UTILITAIRE DE RETRY AVEC BACKOFF EXPONENTIEL
 * Gestion intelligente des erreurs de deadlock (P2034) et timeouts
 */

import { SecureLogger } from "../middlewares/secureLogging.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  retryableErrors?: string[];
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: unknown;
  attempts: number;
  totalTime: number;
}

/**
 * Exécute une fonction avec retry automatique et backoff exponentiel
 * @param operation - Fonction async à exécuter
 * @param options - Options de retry
 * @param context - Contexte pour logging (userId, operation, etc.)
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  context: Record<string, unknown> = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 2000,
    jitter = true,
    retryableErrors = ["P2034", "P2024", "ETIMEDOUT", "ECONNRESET"],
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      SecureLogger.debug(
        `🔄 [RETRY] Tentative ${attempt + 1}/${maxRetries + 1}`,
        {
          ...context,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
        },
      );

      const result = await operation();

      const totalTime = Date.now() - startTime;
      SecureLogger.debug(
        `✅ [RETRY] Succès après ${attempt + 1} tentative(s)`,
        {
          ...context,
          attempts: attempt + 1,
          totalTime,
        },
      );

      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalTime,
      };
    } catch (error: unknown) {
      lastError = error;

      // Type narrowing pour accéder aux propriétés d'erreur
      const errorCode =
        error !== null && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : undefined;
      const errorMessage = error instanceof Error ? error.message : undefined;

      const isRetryable = retryableErrors.some(
        (code) =>
          errorCode === code ||
          errorMessage?.includes(code) ||
          (code === "ETIMEDOUT" && errorMessage?.includes("timeout")),
      );

      SecureLogger.warn(`⚠️ [RETRY] Tentative ${attempt + 1} échouée`, {
        ...context,
        attempt: attempt + 1,
        errorCode,
        errorMessage,
        isRetryable,
        willRetry: isRetryable && attempt < maxRetries,
      });

      // Si ce n'est pas une erreur retriable ou si on a atteint le max
      if (!isRetryable || attempt >= maxRetries) {
        break;
      }

      // Calculer le délai avec backoff exponentiel et jitter
      let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      if (jitter) {
        // Ajouter du jitter (±25%) pour éviter les "thundering herd"
        const jitterAmount = delay * 0.25;
        delay += (Math.random() - 0.5) * 2 * jitterAmount;
      }

      delay = Math.max(delay, baseDelay);

      SecureLogger.debug(`⏳ [RETRY] Attente avant retry`, {
        ...context,
        attempt: attempt + 1,
        delay: Math.round(delay),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const totalTime = Date.now() - startTime;
  // Extraction sécurisée des infos d'erreur pour le log final
  const finalErrorCode =
    lastError !== null && typeof lastError === "object" && "code" in lastError
      ? String((lastError as { code: unknown }).code)
      : undefined;
  const finalErrorMessage =
    lastError instanceof Error ? lastError.message : undefined;

  SecureLogger.error(
    `❌ [RETRY] Échec définitif après ${maxRetries + 1} tentatives`,
    {
      ...context,
      attempts: maxRetries + 1,
      totalTime,
      finalError: {
        code: finalErrorCode,
        message: finalErrorMessage,
      },
    },
  );

  return {
    success: false,
    error: lastError,
    attempts: maxRetries + 1,
    totalTime,
  };
}

/**
 * Wrapper spécialisé pour les opérations Prisma avec deadlock
 * @param operation - Opération Prisma à exécuter
 * @param context - Contexte pour logging
 */
export async function retryPrismaOperation<T>(
  operation: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<RetryResult<T>> {
  return retryWithBackoff(
    operation,
    {
      maxRetries: 3,
      baseDelay: 150, // Délai initial un peu plus long pour Prisma
      maxDelay: 1500,
      jitter: true,
      retryableErrors: ["P2034", "P2024", "P2002"], // Deadlock, Timeout, Constraint violation
    },
    { ...context, type: "prisma_operation" },
  );
}

/**
 * Wrapper spécialisé pour les transactions Prisma
 * @param transaction - Transaction Prisma à exécuter
 * @param context - Contexte pour logging
 */
export async function retryPrismaTransaction<T>(
  transaction: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<RetryResult<T>> {
  return retryWithBackoff(
    transaction,
    {
      maxRetries: 4, // Un peu plus de retries pour les transactions
      baseDelay: 200,
      maxDelay: 2000,
      jitter: true,
      retryableErrors: ["P2034", "P2024"], // Focus sur deadlock et timeout
    },
    { ...context, type: "prisma_transaction" },
  );
}

/**
 * Utilitaire pour calculer un délai d'attente aléatoire (jitter)
 * Utilisé pour étaler les requêtes et éviter les pics de charge
 * @param minMs - Délai minimum en millisecondes
 * @param maxMs - Délai maximum en millisecondes
 */
export function randomJitter(
  minMs: number = 50,
  maxMs: number = 200,
): Promise<void> {
  const delay = Math.random() * (maxMs - minMs) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
