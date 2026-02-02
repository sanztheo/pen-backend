/**
 * 🔧 CONFIGURATION ENVIRONNEMENT BACKEND
 * Gestion intelligente des URLs selon l'environnement (dev/prod)
 */

import { logger } from "./logger.js";
export interface BackendConfig {
  port: number;
  nodeEnv: string;
  clientUrl: string;
  isDevelopment: boolean;
  isProduction: boolean;
}

/**
 * Détecte automatiquement l'environnement et configure les URLs appropriées
 */
function createBackendConfig(): BackendConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const port = parseInt(process.env.PORT || "3001", 10);

  // Détection automatique de l'environnement
  const isDevelopment =
    nodeEnv === "development" || process.env.NODE_ENV === "dev";

  const isProduction = nodeEnv === "production" && !isDevelopment;

  // Configuration des URLs clients autorisées
  let clientUrl: string;

  // Priorité à la variable d'environnement CLIENT_URL si définie
  if (process.env.CLIENT_URL) {
    clientUrl = process.env.CLIENT_URL;
    logger.log(
      `🔧 [BACKEND-CONFIG] CLIENT_URL détecté depuis env - Port: ${port}`,
    );
  } else if (isDevelopment) {
    // Environnement de développement - UNIQUEMENT localhost (pas d'URLs prod)
    clientUrl =
      "http://localhost:5173,http://localhost:3000,http://localhost:4173";
    logger.log(
      `🔧 [BACKEND-CONFIG] Mode développement détecté - Port: ${port}`,
    );
  } else {
    // Environnement de production - domaines de prod autorisés uniquement
    clientUrl = "https://pen-frontend-ashy.vercel.app,https://app.pennote.fr";
    logger.log(`🚀 [BACKEND-CONFIG] Mode production détecté - Port: ${port}`);
  }

  return {
    port,
    nodeEnv,
    clientUrl,
    isDevelopment,
    isProduction,
  };
}

// Export de la configuration
export const backendConfig = createBackendConfig();

// Export des valeurs individuelles pour compatibilité
export const PORT = backendConfig.port;
export const NODE_ENV = backendConfig.nodeEnv;
export const CLIENT_URL = backendConfig.clientUrl;
export const IS_DEVELOPMENT = backendConfig.isDevelopment;
export const IS_PRODUCTION = backendConfig.isProduction;

// Log de la configuration au démarrage
logger.log(`
🔧 Configuration Backend:
   - Environment: ${NODE_ENV}
   - Port: ${PORT}
   - Development: ${IS_DEVELOPMENT}
   - Production: ${IS_PRODUCTION}
   - Client URLs: ${CLIENT_URL}
`);
