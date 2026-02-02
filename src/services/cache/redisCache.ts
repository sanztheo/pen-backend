import Redis from "ioredis";

// Configuration Redis (Railway ou local)
const redisUrl =
  process.env.REDIS_URL ||
  process.env.REDIS_PUBLIC_URL ||
  "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  // Timeouts pour éviter les blocages
  connectTimeout: 10000,
  commandTimeout: 5000,
  // Connection pooling
  enableOfflineQueue: true,
});

// Gestion des erreurs Redis
redis.on("error", (error) => {
  console.error("❌ [Redis] Erreur de connexion:", error);
});

redis.on("connect", () => {
  console.log("✅ [Redis] Connexion établie");
});

redis.on("ready", () => {
  console.log("✅ [Redis] Prêt à accepter les commandes");
});

redis.on("reconnecting", () => {
  console.warn("🔄 [Redis] Reconnexion en cours...");
});

// Types
interface CacheOptions {
  ttl?: number; // Time to live en secondes (default: 2 minutes)
  namespace?: string; // Namespace pour organiser les clés
}

type CacheParser<T> = (value: unknown) => T;

function safeJsonParse(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

/**
 * Service de cache Redis avec support optimiste et rollback
 */
class RedisCacheService {
  private defaultTTL = 120; // 2 minutes par défaut
  private defaultNamespace = "pennote";

  /**
   * Génère une clé de cache avec namespace
   */
  private getKey(key: string, namespace?: string): string {
    const ns = namespace || this.defaultNamespace;
    return `${ns}:${key}`;
  }

  /**
   * Récupère une valeur du cache
   */
  async get<T>(
    key: string,
    parse: CacheParser<T>,
    options?: CacheOptions,
  ): Promise<T | null> {
    try {
      const cacheKey = this.getKey(key, options?.namespace);
      const data = await redis.get(cacheKey);

      if (!data) {
        console.log(`🔍 [Redis Cache] MISS: ${cacheKey}`);
        return null;
      }

      console.log(`✅ [Redis Cache] HIT: ${cacheKey}`);
      const parsed = safeJsonParse(data);
      return parse(parsed);
    } catch (error) {
      console.error(`❌ [Redis Cache] Erreur GET ${key}:`, error);
      return null; // Fallback gracieux en cas d'erreur
    }
  }

  /**
   * Stocke une valeur dans le cache
   */
  async set<T>(
    key: string,
    value: T,
    options?: CacheOptions,
  ): Promise<boolean> {
    try {
      const cacheKey = this.getKey(key, options?.namespace);
      const ttl = options?.ttl || this.defaultTTL;
      const serialized = JSON.stringify(value);

      await redis.setex(cacheKey, ttl, serialized);
      console.log(`💾 [Redis Cache] SET: ${cacheKey} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      console.error(`❌ [Redis Cache] Erreur SET ${key}:`, error);
      return false;
    }
  }

  /**
   * Invalide une clé de cache
   */
  async invalidate(key: string, options?: CacheOptions): Promise<boolean> {
    try {
      const cacheKey = this.getKey(key, options?.namespace);
      const result = await redis.del(cacheKey);
      console.log(`🗑️ [Redis Cache] INVALIDATE: ${cacheKey}`);
      return result > 0;
    } catch (error) {
      console.error(`❌ [Redis Cache] Erreur INVALIDATE ${key}:`, error);
      return false;
    }
  }

  /**
   * Invalide toutes les clés correspondant à un pattern
   */
  async invalidatePattern(
    pattern: string,
    options?: CacheOptions,
  ): Promise<number> {
    try {
      const namespace = options?.namespace || this.defaultNamespace;
      const fullPattern = `${namespace}:${pattern}`;

      const keys = await redis.keys(fullPattern);
      if (keys.length === 0) {
        console.log(
          `🔍 [Redis Cache] Aucune clé trouvée pour pattern: ${fullPattern}`,
        );
        return 0;
      }

      const result = await redis.del(...keys);
      console.log(
        `🗑️ [Redis Cache] INVALIDATE PATTERN: ${fullPattern} (${result} clés supprimées)`,
      );
      return result;
    } catch (error) {
      console.error(
        `❌ [Redis Cache] Erreur INVALIDATE PATTERN ${pattern}:`,
        error,
      );
      return 0;
    }
  }

  /**
   * Vérifie si une clé existe dans le cache
   */
  async exists(key: string, options?: CacheOptions): Promise<boolean> {
    try {
      const cacheKey = this.getKey(key, options?.namespace);
      const result = await redis.exists(cacheKey);
      return result === 1;
    } catch (error) {
      console.error(`❌ [Redis Cache] Erreur EXISTS ${key}:`, error);
      return false;
    }
  }

  /**
   * Récupère ou génère une valeur (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    parse: CacheParser<T>,
    options?: CacheOptions,
  ): Promise<T> {
    try {
      // Essayer de récupérer depuis le cache
      const cached = await this.get(key, parse, options);
      if (cached !== null) {
        return cached;
      }

      // Si pas en cache, générer la valeur
      console.log(`🔄 [Redis Cache] Génération pour: ${key}`);
      const value = await factory();

      // Stocker en cache (fire and forget)
      this.set(key, value, options).catch((error) => {
        console.warn(`⚠️ [Redis Cache] Échec stockage ${key}:`, error);
      });

      return value;
    } catch (error) {
      console.error(`❌ [Redis Cache] Erreur GET_OR_SET ${key}:`, error);
      // En cas d'erreur, appeler directement le factory
      return factory();
    }
  }

  /**
   * Supprime toutes les clés d'un namespace
   */
  async flushNamespace(namespace: string): Promise<number> {
    return this.invalidatePattern("*", { namespace });
  }

  /**
   * Vérifie la santé de la connexion Redis
   */
  async healthCheck(): Promise<boolean> {
    try {
      await redis.ping();
      return true;
    } catch (error) {
      console.error("❌ [Redis] Health check failed:", error);
      return false;
    }
  }

  /**
   * Ferme la connexion Redis
   */
  async disconnect(): Promise<void> {
    try {
      await redis.quit();
      console.log("👋 [Redis] Connexion fermée proprement");
    } catch (error) {
      console.error("❌ [Redis] Erreur lors de la fermeture:", error);
    }
  }
}

// Export singleton
export const redisCache = new RedisCacheService();
