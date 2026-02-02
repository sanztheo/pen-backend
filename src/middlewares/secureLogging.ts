/**
 * 🔒 MIDDLEWARE DE LOGGING SÉCURISÉ
 * Réduit la verbosité des logs en production et filtre les données sensibles
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

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
      const errorMessage =
        error instanceof Error ? error.message : "Erreur interne";
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
  static audit(
    message: string,
    data?: { userId?: string; action?: string; resource?: string },
  ) {
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
  private static sanitizeData(
    data: unknown,
    options?: SecureLogOptions,
  ): unknown {
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

    const sensitiveFields = [
      ...defaultSensitiveFields,
      ...(options?.sensitiveFields || []),
    ];
    const maxLength = options?.maxLength || 100;

    // Type guard: data is already verified as object above
    const dataRecord = data as Record<string, unknown>;
    const sanitized: Record<string, unknown> = { ...dataRecord };

    Object.keys(sanitized).forEach((key) => {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some((field) =>
        lowerKey.includes(field),
      );

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
export const secureRequestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
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
