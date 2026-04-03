/**
 * 🔄 CANONICAL RETRY MODULE
 * All retry logic consolidated here. Two strategies:
 * - withRetry: DB connection-aware retry (checks ensureConnection)
 * - retryWithBackoff: General-purpose retry with jitter, configurable error codes
 */

import { ensureConnection } from "./prisma.js";
import { logger } from "../utils/logger.js";

// ─── DB Connection Retry ────────────────────────────────

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const connectionOk = await ensureConnection();
        if (!connectionOk) {
          throw new Error(`Connexion impossible après ${attempt} tentatives`);
        }
      }

      return await operation();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        error !== null && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : undefined;

      const isConnectionError =
        errorMessage?.includes("Can't reach database server") ||
        errorMessage?.includes("Connection") ||
        errorMessage?.includes("Server has closed") ||
        errorCode === "P1001" ||
        errorCode === "P1017"; // Neon cold start

      if (attempt === maxRetries || !isConnectionError) {
        logger.error(`❌ Échec final après ${attempt} tentatives:`, errorMessage);
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(
        `⚠️ Tentative ${attempt}/${maxRetries} échouée, retry dans ${delay}ms:`,
        errorMessage,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Nombre maximum de tentatives atteint");
}

// ─── General-Purpose Retry with Backoff ─────────────────

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
      logger.debug(`🔄 [RETRY] Tentative ${attempt + 1}/${maxRetries + 1}`, {
        ...context,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
      });

      const result = await operation();

      const totalTime = Date.now() - startTime;
      logger.debug(`✅ [RETRY] Succès après ${attempt + 1} tentative(s)`, {
        ...context,
        attempts: attempt + 1,
        totalTime,
      });

      return {
        success: true,
        data: result,
        attempts: attempt + 1,
        totalTime,
      };
    } catch (error: unknown) {
      lastError = error;

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

      logger.warn(`⚠️ [RETRY] Tentative ${attempt + 1} échouée`, {
        ...context,
        attempt: attempt + 1,
        errorCode,
        errorMessage,
        isRetryable,
        willRetry: isRetryable && attempt < maxRetries,
      });

      if (!isRetryable || attempt >= maxRetries) {
        break;
      }

      let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      if (jitter) {
        const jitterAmount = delay * 0.25;
        delay += (Math.random() - 0.5) * 2 * jitterAmount;
      }

      delay = Math.max(delay, baseDelay);

      logger.debug(`⏳ [RETRY] Attente avant retry`, {
        ...context,
        attempt: attempt + 1,
        delay: Math.round(delay),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const totalTime = Date.now() - startTime;
  const finalErrorCode =
    lastError !== null && typeof lastError === "object" && "code" in lastError
      ? String((lastError as { code: unknown }).code)
      : undefined;
  const finalErrorMessage = lastError instanceof Error ? lastError.message : undefined;

  logger.error(`❌ [RETRY] Échec définitif après ${maxRetries + 1} tentatives`, {
    ...context,
    attempts: maxRetries + 1,
    totalTime,
    finalError: {
      code: finalErrorCode,
      message: finalErrorMessage,
    },
  });

  return {
    success: false,
    error: lastError,
    attempts: maxRetries + 1,
    totalTime,
  };
}

// ─── Prisma-Specific Wrappers ───────────────────────────

export async function retryPrismaOperation<T>(
  operation: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<RetryResult<T>> {
  return retryWithBackoff(
    operation,
    {
      maxRetries: 3,
      baseDelay: 150,
      maxDelay: 1500,
      jitter: true,
      retryableErrors: ["P2034", "P2024", "P2002"],
    },
    { ...context, type: "prisma_operation" },
  );
}

export async function retryPrismaTransaction<T>(
  transaction: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<RetryResult<T>> {
  return retryWithBackoff(
    transaction,
    {
      maxRetries: 4,
      baseDelay: 200,
      maxDelay: 2000,
      jitter: true,
      retryableErrors: ["P2034", "P2024"],
    },
    { ...context, type: "prisma_transaction" },
  );
}

export function randomJitter(minMs: number = 50, maxMs: number = 200): Promise<void> {
  const delay = Math.random() * (maxMs - minMs) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
