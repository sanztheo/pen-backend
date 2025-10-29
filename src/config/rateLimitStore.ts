/**
 * 🛡️ CONFIGURATION DU STORE REDIS POUR RATE LIMITING
 * Utilise Redis pour stocker les compteurs de rate limiting de manière distribuée
 */

import { RedisStore } from 'rate-limit-redis';
import { redis } from '../lib/redis.js';

/**
 * Crée un store Redis UNIQUE pour un rate limiter spécifique
 * IMPORTANT: Chaque rate limiter doit avoir son propre store avec un préfixe unique
 * @param prefix - Préfixe unique pour ce rate limiter (ex: 'rl:global', 'rl:auth')
 */
export const createRateLimitStore = (prefix: string = 'rl:') => {
  return new RedisStore({
    // @ts-expect-error - rate-limit-redis attend une signature différente de ioredis
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix, // Préfixe UNIQUE pour ce store
  });
};

/**
 * Configuration pour fallback en cas d'échec Redis
 * Si Redis n'est pas disponible, utilise le stockage en mémoire (moins robuste mais fonctionnel)
 */
export const getRateLimitStoreWithFallback = (prefix: string = 'rl:') => {
  try {
    return createRateLimitStore(prefix);
  } catch (error) {
    console.warn(`⚠️ [RATE-LIMIT] Redis indisponible pour ${prefix}, utilisation du store en mémoire`);
    // Retourner undefined pour utiliser le store en mémoire par défaut
    return undefined;
  }
};
