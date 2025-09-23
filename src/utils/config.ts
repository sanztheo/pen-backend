/**
 * 🔧 CONFIGURATION ENVIRONNEMENT BACKEND
 * Gestion intelligente des URLs selon l'environnement (dev/prod)
 */

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
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.PORT || '3001', 10);
  
  // Détection automatique de l'environnement
  const isDevelopment = nodeEnv === 'development' || 
                       process.env.NODE_ENV === 'dev' ||
                       port === 3001; // Port de développement typique
  
  const isProduction = nodeEnv === 'production' && !isDevelopment;
  
  // Configuration des URLs clients autorisées
  let clientUrl: string;
  
  if (isDevelopment) {
    // Environnement de développement - autoriser localhost
    clientUrl = 'http://localhost:5173,http://localhost:3000,http://localhost:4173,https://pen-frontend-ashy.vercel.app';
    console.log(`🔧 [BACKEND-CONFIG] Mode développement détecté - Port: ${port}`);
  } else {
    // Environnement de production - uniquement les domaines de prod
    clientUrl = 'https://pen-frontend-ashy.vercel.app';
    console.log(`🚀 [BACKEND-CONFIG] Mode production détecté - Port: ${port}`);
  }
  
  return {
    port,
    nodeEnv,
    clientUrl,
    isDevelopment,
    isProduction
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
console.log(`
🔧 Configuration Backend:
   - Environment: ${NODE_ENV}
   - Port: ${PORT}
   - Development: ${IS_DEVELOPMENT}
   - Production: ${IS_PRODUCTION}
   - Client URLs: ${CLIENT_URL}
`);