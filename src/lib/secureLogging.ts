/**
 * 🛡️ Utilitaires de logging sécurisé pour éviter les fuites de données sensibles
 */

// Patterns de données sensibles à masquer
import { logger } from "../utils/logger.js";
const SENSITIVE_PATTERNS = [
  // Tokens et clés
  /(?:token|key|password|secret|credential)[\"':\s]*([a-zA-Z0-9+/=]{10,})/gi,
  // Emails
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  // Contenu utilisateur très long (potentiellement sensible)
  /content[\"':\s]*[\"'](.{200,})[\"']/gi,
  // Prompts utilisateur
  /prompt[\"':\s]*[\"'](.{100,})[\"']/gi,
  // Numéros de téléphone
  /[\+]?[1-9]?[0-9]{7,15}/g,
  // IDs utilisateur Clerk
  /user_[a-zA-Z0-9]{20,}/gi,
];

/**
 * Masque les données sensibles dans un message de log
 */
export const sanitizeLogMessage = (message: unknown): string => {
  let messageStr: string;
  if (typeof message !== "string") {
    try {
      messageStr = JSON.stringify(message, null, 2);
    } catch {
      messageStr = String(message);
    }
  } else {
    messageStr = message;
  }

  let sanitized = messageStr;

  // Appliquer les patterns de masquage
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match: string, captured: string) => {
      if (captured && captured.length > 10) {
        return match.replace(captured, `${captured.substring(0, 4)}...**MASKED**`);
      }
      return match.replace(captured || match, "**MASKED**");
    });
  }

  // Limiter la longueur totale du message
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + "...[TRUNCATED]";
  }

  return sanitized;
};

/**
 * Console.error sécurisé
 */
export const secureError = (message: string, error?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);

  if (error) {
    // Masquer les détails de l'erreur qui pourraient contenir des données sensibles
    const errorInfo: Record<string, unknown> = {};

    if (error instanceof Error) {
      errorInfo.name = error.name;
      errorInfo.message = sanitizeLogMessage(error.message);
      errorInfo.stack = process.env.NODE_ENV === "development" ? error.stack : undefined;
    }

    // Extraire code/status si présents (erreurs HTTP)
    if (typeof error === "object" && error !== null) {
      const errObj = error as Record<string, unknown>;
      if ("code" in errObj) errorInfo.code = errObj.code;
      if ("status" in errObj) errorInfo.status = errObj.status;
    }

    logger.error(sanitizedMessage, errorInfo);
  } else {
    logger.error(sanitizedMessage);
  }
};

/**
 * Console.log sécurisé
 */
export const secureLog = (message: string, data?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);

  if (data) {
    const sanitizedData = sanitizeLogMessage(data);
    logger.log(sanitizedMessage, sanitizedData);
  } else {
    logger.log(sanitizedMessage);
  }
};

/**
 * Console.warn sécurisé
 */
export const secureWarn = (message: string, data?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);

  if (data) {
    const sanitizedData = sanitizeLogMessage(data);
    logger.warn(sanitizedMessage, sanitizedData);
  } else {
    logger.warn(sanitizedMessage);
  }
};

/**
 * Extraire uniquement les métadonnées sûres d'un objet pour le logging
 */
export const extractSafeMetadata = (obj: unknown): Record<string, unknown> => {
  if (!obj || typeof obj !== "object") return {};

  const objRecord = obj as Record<string, unknown>;

  const safeFields = [
    "id",
    "type",
    "status",
    "method",
    "url",
    "statusCode",
    "timestamp",
    "duration",
    "length",
    "count",
    "size",
    "version",
    "model",
    "temperature",
    "maxTokens",
  ];

  const metadata: Record<string, unknown> = {};

  for (const field of safeFields) {
    if (objRecord[field] !== undefined) {
      metadata[field] = objRecord[field];
    }
  }

  // Ajouter des longueurs de champs sensibles sans exposer le contenu
  if (objRecord.content) metadata.contentLength = String(objRecord.content).length;
  if (objRecord.prompt) metadata.promptLength = String(objRecord.prompt).length;
  if (objRecord.text) metadata.textLength = String(objRecord.text).length;
  if (objRecord.message) metadata.messageLength = String(objRecord.message).length;

  return metadata;
};
