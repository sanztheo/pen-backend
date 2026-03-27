/**
 * 🔒 CANONICAL SECURE LOGGING MODULE
 * Class-based SecureLogger + functional helpers + Express middleware.
 * All secure logging consolidated here.
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

// ─── Sensitive Data Patterns (regex-based sanitization) ─

const SENSITIVE_PATTERNS = [
  /(?:token|key|password|secret|credential)[\"':\s]*([a-zA-Z0-9+/=]{10,})/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  /content[\"':\s]*[\"'](.{200,})[\"']/gi,
  /prompt[\"':\s]*[\"'](.{100,})[\"']/gi,
  /[\+]?[1-9]?[0-9]{7,15}/g,
  /user_[a-zA-Z0-9]{20,}/gi,
];

// ─── Functional Helpers ─────────────────────────────────

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
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match: string, captured: string) => {
      if (captured && captured.length > 10) {
        return match.replace(captured, `${captured.substring(0, 4)}...**MASKED**`);
      }
      return match.replace(captured || match, "**MASKED**");
    });
  }

  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + "...[TRUNCATED]";
  }

  return sanitized;
};

export const secureError = (message: string, error?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);

  if (error) {
    const errorInfo: Record<string, unknown> = {};
    if (error instanceof Error) {
      errorInfo.name = error.name;
      errorInfo.message = sanitizeLogMessage(error.message);
      errorInfo.stack = process.env.NODE_ENV === "development" ? error.stack : undefined;
    }
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

export const secureLog = (message: string, data?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);
  if (data) {
    logger.log(sanitizedMessage, sanitizeLogMessage(data));
  } else {
    logger.log(sanitizedMessage);
  }
};

export const secureWarn = (message: string, data?: unknown): void => {
  const sanitizedMessage = sanitizeLogMessage(message);
  if (data) {
    logger.warn(sanitizedMessage, sanitizeLogMessage(data));
  } else {
    logger.warn(sanitizedMessage);
  }
};

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

  if (objRecord.content) metadata.contentLength = String(objRecord.content).length;
  if (objRecord.prompt) metadata.promptLength = String(objRecord.prompt).length;
  if (objRecord.text) metadata.textLength = String(objRecord.text).length;
  if (objRecord.message) metadata.messageLength = String(objRecord.message).length;

  return metadata;
};

// ─── Class-Based SecureLogger ───────────────────────────

export interface SecureLogOptions {
  maxLength?: number;
  hideInProduction?: boolean;
  sensitiveFields?: string[];
}

/**
 * Logger sécurisé qui filtre les données sensibles
 */
export class SecureLogger {
  private static isProduction = process.env.NODE_ENV === "production";

  /**
   * Log sécurisé qui masque les données sensibles en production
   */
  static log(message: string, data?: unknown, options?: SecureLogOptions) {
    if (options?.hideInProduction && this.isProduction) {
      return; // Skip en production
    }

    const sanitizedData = this.sanitizeData(data, options);
    logger.log(message, sanitizedData);
  }

  /**
   * Error log toujours affiché mais avec données sanitizées
   */
  static error(message: string, error?: unknown) {
    if (this.isProduction) {
      // En production, logs minimaux
      const errorMessage = error instanceof Error ? error.message : "Erreur interne";
      logger.error(message, errorMessage);
    } else {
      logger.error(message, error);
    }
  }

  /**
   * Warning log avec sanitisation
   */
  static warn(message: string, data?: unknown, options?: SecureLogOptions) {
    const sanitizedData = this.sanitizeData(data, options);
    logger.warn(message, sanitizedData);
  }

  /**
   * Debug log seulement en développement
   */
  static debug(message: string, data?: unknown) {
    if (!this.isProduction) {
      logger.debug(message, data);
    }
  }

  /**
   * Audit log pour les actions critiques (toujours affiché)
   */
  static audit(message: string, data?: { userId?: string; action?: string; resource?: string }) {
    const auditData = {
      timestamp: new Date().toISOString(),
      userId: data?.userId || "unknown",
      action: data?.action || "unknown",
      resource: data?.resource || "unknown",
    };
    logger.info(`🔒 [AUDIT] ${message}`, auditData);
  }

  /**
   * Sanitise les données en supprimant les champs sensibles
   */
  private static sanitizeData(data: unknown, options?: SecureLogOptions): unknown {
    if (!data || typeof data !== "object") {
      return data;
    }

    const defaultSensitiveFields = [
      "password",
      "token",
      "key",
      "secret",
      "auth",
      "credential",
      "content",
      "prompt",
      "messages",
      "response",
      "input",
      "output",
    ];

    const sensitiveFields = [...defaultSensitiveFields, ...(options?.sensitiveFields || [])];
    const maxLength = options?.maxLength || 100;

    // Type guard: data is already verified as object above
    const dataRecord = data as Record<string, unknown>;
    const sanitized: Record<string, unknown> = { ...dataRecord };

    Object.keys(sanitized).forEach((key) => {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some((field) => lowerKey.includes(field));

      if (isSensitive) {
        if (this.isProduction) {
          sanitized[key] = "[REDACTED]";
        } else {
          // En dev, tronquer seulement
          const value = sanitized[key];
          if (typeof value === "string" && value.length > maxLength) {
            sanitized[key] = value.substring(0, maxLength) + "...";
          }
        }
      }
    });

    return sanitized;
  }
}

/**
 * Middleware Express pour logger les requêtes de manière sécurisée
 */
export const secureRequestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  // Log seulement en développement ou pour les erreurs
  if (process.env.NODE_ENV !== "production") {
    SecureLogger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get("User-Agent")?.substring(0, 50),
    });
  }

  res.on("finish", () => {
    const duration = Date.now() - start;

    // Log des erreurs même en production
    if (res.statusCode >= 400) {
      SecureLogger.error(`${req.method} ${req.path} - ${res.statusCode}`, {
        duration,
        status: res.statusCode,
        ip: req.ip,
      });
    }
  });

  next();
};
