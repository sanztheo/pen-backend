// assistant/utils/retry.ts - Utilitaires pour la gestion des retries

import type { RetryOptions } from "../types/index.js";
import { validateAssistantResponse } from "./validation.js";
import { logger } from "../../../../utils/logger.js";

/**
 * Exécute une opération avec retry automatique et validation JSON
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    validateJson = true,
    operationName = "Assistant operation",
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.log(`🔄 ${operationName} - Tentative ${attempt}/${maxRetries}`);

      const result = await operation();

      if (validateJson && result) {
        validateAssistantResponse(result);
      }

      logger.log(`✅ ${operationName} - Succès à la tentative ${attempt}`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.error(
        `❌ ${operationName} - Échec tentative ${attempt}:`,
        lastError.message,
      );

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // Backoff exponentiel
        logger.log(`⏳ Attente ${delay}ms avant retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `${operationName} a échoué après ${maxRetries} tentatives. Dernière erreur: ${lastError?.message}`,
  );
}

/**
 * Wrapper pour les méthodes de génération avec retry
 */
export async function generateWithRetry<T>(
  generatorFn: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return executeWithRetry(generatorFn, {
    maxRetries: 3,
    retryDelay: 2000,
    validateJson: true,
    operationName: `Génération: ${operationName}`,
  });
}

/**
 * Wrapper pour les méthodes de correction avec retry
 */
export async function correctWithRetry<T>(
  correctorFn: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return executeWithRetry(correctorFn, {
    maxRetries: 2, // Moins de retry pour la correction
    retryDelay: 1500,
    validateJson: true,
    operationName: `Correction: ${operationName}`,
  });
}
