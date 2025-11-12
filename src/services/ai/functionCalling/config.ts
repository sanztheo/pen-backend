/**
 * 🎚️ FUNCTION CALLING CONFIGURATION
 *
 * Configuration centralisée pour le système de function calling.
 * Permet l'A/B testing entre l'ancien système (orchestrate) et le nouveau système optimisé (orchestrateOptimized).
 */

/**
 * Configuration du système de function calling
 */
export interface FunctionCallingConfig {
  /**
   * Active le nouveau système optimisé (architecture Cursor-inspired)
   * - true: Utilise orchestrateOptimized() (recommandé)
   * - false: Utilise orchestrate() (ancien système)
   */
  useOptimizedArchitecture: boolean;

  /**
   * Active les métriques détaillées
   * - Tracking des performances
   * - Comparaison avec baseline
   * - Logs de métriques
   */
  enableMetrics: boolean;

  /**
   * Active le prompt caching (quand disponible dans OpenAI API)
   * - Réduit les coûts de 90% sur les prompts statiques
   * - Améliore la latence
   */
  enablePromptCaching: boolean;

  /**
   * Mode debug pour logs verbeux
   */
  debugMode: boolean;

  /**
   * Seuil de score pour déclencher une réflexion stratégique
   * - Plus bas = plus de réflexions (plus précis, plus cher)
   * - Plus haut = moins de réflexions (plus rapide, moins précis)
   */
  reflectionScoreThreshold: number;
}

/**
 * Configuration par défaut
 */
const DEFAULT_CONFIG: FunctionCallingConfig = {
  // ✅ NOUVEAU SYSTÈME ACTIVÉ PAR DÉFAUT
  // L'architecture optimisée offre de meilleures performances sans compromis de qualité
  useOptimizedArchitecture: true,

  // Métriques activées pour monitoring
  enableMetrics: true,

  // Prompt caching (sera activé quand OpenAI le supporte officiellement)
  enablePromptCaching: false,

  // Debug mode désactivé en production
  debugMode: false,

  // Seuil de réflexion: 0.4 = réflexion si score < 40% (équilibre qualité/coût)
  reflectionScoreThreshold: 0.4,
};

/**
 * Configuration actuelle (peut être overridée par variables d'environnement)
 */
let currentConfig: FunctionCallingConfig = { ...DEFAULT_CONFIG };

/**
 * Service de configuration
 */
export class FunctionCallingConfigService {
  /**
   * Récupère la configuration actuelle
   */
  static getConfig(): FunctionCallingConfig {
    return { ...currentConfig };
  }

  /**
   * Met à jour la configuration
   *
   * @param updates - Mises à jour partielles de la configuration
   */
  static updateConfig(updates: Partial<FunctionCallingConfig>): void {
    currentConfig = {
      ...currentConfig,
      ...updates,
    };

    console.log("⚙️ [CONFIG] Configuration updated:", currentConfig);
  }

  /**
   * Réinitialise la configuration aux valeurs par défaut
   */
  static resetConfig(): void {
    currentConfig = { ...DEFAULT_CONFIG };
    console.log("⚙️ [CONFIG] Configuration reset to defaults");
  }

  /**
   * Charge la configuration depuis les variables d'environnement
   *
   * Variables supportées:
   * - USE_OPTIMIZED_ARCHITECTURE=true/false
   * - ENABLE_METRICS=true/false
   * - ENABLE_PROMPT_CACHING=true/false
   * - DEBUG_MODE=true/false
   * - REFLECTION_SCORE_THRESHOLD=0.0-1.0
   */
  static loadFromEnv(): void {
    const env = process.env;

    if (env.USE_OPTIMIZED_ARCHITECTURE !== undefined) {
      currentConfig.useOptimizedArchitecture =
        env.USE_OPTIMIZED_ARCHITECTURE === "true";
    }

    if (env.ENABLE_METRICS !== undefined) {
      currentConfig.enableMetrics = env.ENABLE_METRICS === "true";
    }

    if (env.ENABLE_PROMPT_CACHING !== undefined) {
      currentConfig.enablePromptCaching = env.ENABLE_PROMPT_CACHING === "true";
    }

    if (env.DEBUG_MODE !== undefined) {
      currentConfig.debugMode = env.DEBUG_MODE === "true";
    }

    if (env.REFLECTION_SCORE_THRESHOLD !== undefined) {
      const threshold = parseFloat(env.REFLECTION_SCORE_THRESHOLD);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
        currentConfig.reflectionScoreThreshold = threshold;
      }
    }

    console.log("⚙️ [CONFIG] Configuration loaded from environment:", currentConfig);
  }

  /**
   * Active temporairement le mode debug
   *
   * @param duration - Durée en millisecondes (par défaut: 5 minutes)
   */
  static enableDebugTemporarily(duration: number = 5 * 60 * 1000): void {
    const previousValue = currentConfig.debugMode;
    currentConfig.debugMode = true;

    console.log(`🐛 [CONFIG] Debug mode enabled for ${duration}ms`);

    setTimeout(() => {
      currentConfig.debugMode = previousValue;
      console.log("🐛 [CONFIG] Debug mode auto-disabled");
    }, duration);
  }

  /**
   * Force l'utilisation de l'ancien système pour un test spécifique
   *
   * Utile pour A/B testing manuel
   */
  static useLegacySystemForTest(): void {
    const previous = currentConfig.useOptimizedArchitecture;
    currentConfig.useOptimizedArchitecture = false;

    console.warn(
      "⚠️ [CONFIG] LEGACY SYSTEM ACTIVATED - Remember to revert after test!",
    );

    // Auto-revert après 1 heure pour éviter d'oublier
    setTimeout(() => {
      currentConfig.useOptimizedArchitecture = previous;
      console.log("✅ [CONFIG] Auto-reverted to optimized system");
    }, 60 * 60 * 1000);
  }
}

// Charger la configuration au démarrage
FunctionCallingConfigService.loadFromEnv();
