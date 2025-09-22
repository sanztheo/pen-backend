/**
 * 🛡️ Utilitaires de logging sécurisé pour éviter les fuites de données sensibles
 */

// Patterns de données sensibles à masquer
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
export const sanitizeLogMessage = (message: any): string => {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message, null, 2);
    } catch (error) {
      message = String(message);
    }
  }

  let sanitized = message;
  
  // Appliquer les patterns de masquage
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match: string, captured: string) => {
      if (captured && captured.length > 10) {
        return match.replace(captured, `${captured.substring(0, 4)}...**MASKED**`);
      }
      return match.replace(captured || match, '**MASKED**');
    });
  }

  // Limiter la longueur totale du message
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000) + '...[TRUNCATED]';
  }

  return sanitized;
};

/**
 * Console.error sécurisé
 */
export const secureError = (message: string, error?: any): void => {
  const sanitizedMessage = sanitizeLogMessage(message);
  
  if (error) {
    // Masquer les détails de l'erreur qui pourraient contenir des données sensibles
    const errorInfo = {
      name: error.name,
      message: error.message ? sanitizeLogMessage(error.message) : undefined,
      code: error.code,
      status: error.status,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    console.error(sanitizedMessage, errorInfo);
  } else {
    console.error(sanitizedMessage);
  }
};

/**
 * Console.log sécurisé
 */
export const secureLog = (message: string, data?: any): void => {
  const sanitizedMessage = sanitizeLogMessage(message);
  
  if (data) {
    const sanitizedData = sanitizeLogMessage(data);
    console.log(sanitizedMessage, sanitizedData);
  } else {
    console.log(sanitizedMessage);
  }
};

/**
 * Console.warn sécurisé
 */
export const secureWarn = (message: string, data?: any): void => {
  const sanitizedMessage = sanitizeLogMessage(message);
  
  if (data) {
    const sanitizedData = sanitizeLogMessage(data);
    console.warn(sanitizedMessage, sanitizedData);
  } else {
    console.warn(sanitizedMessage);
  }
};

/**
 * Extraire uniquement les métadonnées sûres d'un objet pour le logging
 */
export const extractSafeMetadata = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return {};
  
  const safeFields = [
    'id', 'type', 'status', 'method', 'url', 'statusCode', 
    'timestamp', 'duration', 'length', 'count', 'size',
    'version', 'model', 'temperature', 'maxTokens'
  ];
  
  const metadata: any = {};
  
  for (const field of safeFields) {
    if (obj[field] !== undefined) {
      metadata[field] = obj[field];
    }
  }
  
  // Ajouter des longueurs de champs sensibles sans exposer le contenu
  if (obj.content) metadata.contentLength = String(obj.content).length;
  if (obj.prompt) metadata.promptLength = String(obj.prompt).length;
  if (obj.text) metadata.textLength = String(obj.text).length;
  if (obj.message) metadata.messageLength = String(obj.message).length;
  
  return metadata;
};