/**
 * 🔒 MIDDLEWARE DE LOGGING SÉCURISÉ
 * Réduit la verbosité des logs en production et filtre les données sensibles
 */

export interface SecureLogOptions {
  maxLength?: number;
  hideInProduction?: boolean;
  sensitiveFields?: string[];
}

/**
 * Logger sécurisé qui filtre les données sensibles
 */
export class SecureLogger {
  private static isProduction = process.env.NODE_ENV === 'production';
  
  /**
   * Log sécurisé qui masque les données sensibles en production
   */
  static log(message: string, data?: any, options?: SecureLogOptions) {
    if (options?.hideInProduction && this.isProduction) {
      return; // Skip en production
    }
    
    const sanitizedData = this.sanitizeData(data, options);
    console.log(message, sanitizedData);
  }
  
  /**
   * Error log toujours affiché mais avec données sanitizées
   */
  static error(message: string, error?: any) {
    if (this.isProduction) {
      // En production, logs minimaux
      console.error(message, error?.message || 'Erreur interne');
    } else {
      console.error(message, error);
    }
  }
  
  /**
   * Warning log avec sanitisation
   */
  static warn(message: string, data?: any, options?: SecureLogOptions) {
    const sanitizedData = this.sanitizeData(data, options);
    console.warn(message, sanitizedData);
  }
  
  /**
   * Debug log seulement en développement
   */
  static debug(message: string, data?: any) {
    if (!this.isProduction) {
      console.log(`🐛 [DEBUG] ${message}`, data);
    }
  }
  
  /**
   * Audit log pour les actions critiques (toujours affiché)
   */
  static audit(message: string, data?: { userId?: string; action?: string; resource?: string }) {
    const auditData = {
      timestamp: new Date().toISOString(),
      userId: data?.userId || 'unknown',
      action: data?.action || 'unknown',
      resource: data?.resource || 'unknown'
    };
    console.log(`🔒 [AUDIT] ${message}`, auditData);
  }
  
  /**
   * Sanitise les données en supprimant les champs sensibles
   */
  private static sanitizeData(data: any, options?: SecureLogOptions): any {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const defaultSensitiveFields = [
      'password', 'token', 'key', 'secret', 'auth', 'credential',
      'content', 'prompt', 'messages', 'response', 'input', 'output'
    ];
    
    const sensitiveFields = [...defaultSensitiveFields, ...(options?.sensitiveFields || [])];
    const maxLength = options?.maxLength || 100;
    
    const sanitized = { ...data };
    
    Object.keys(sanitized).forEach(key => {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
      
      if (isSensitive) {
        if (this.isProduction) {
          sanitized[key] = '[REDACTED]';
        } else {
          // En dev, tronquer seulement
          if (typeof sanitized[key] === 'string' && sanitized[key].length > maxLength) {
            sanitized[key] = sanitized[key].substring(0, maxLength) + '...';
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
export const secureRequestLogger = (req: any, res: any, next: any) => {
  const start = Date.now();
  
  // Log seulement en développement ou pour les erreurs
  if (process.env.NODE_ENV !== 'production') {
    SecureLogger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent')?.substring(0, 50)
    });
  }
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Log des erreurs même en production
    if (res.statusCode >= 400) {
      SecureLogger.error(`${req.method} ${req.path} - ${res.statusCode}`, {
        duration,
        status: res.statusCode,
        ip: req.ip
      });
    }
  });
  
  next();
};

export default SecureLogger;