/**
 * 🧠 ContextCacheService - PEN-20
 * Cache du contexte intelligent (RAG, clusters, distribution)
 *
 * IMPORTANT: On cache uniquement le CONTEXTE préparatoire, PAS les questions.
 * Les questions sont toujours générées fraîches pour que l'utilisateur
 * puisse réviser avec des questions différentes à chaque fois.
 *
 * Ce qu'on cache (économie ~50% du temps):
 * - Contexte RAG enrichi
 * - Clusters thématiques
 * - Distribution des questions par cluster
 * - Concepts extraits
 *
 * Ce qu'on génère toujours frais:
 * - Questions
 * - Options de réponse
 * - Ordre des questions
 */

import { redis } from "../../../lib/redis.js";
import { prisma } from "../../../lib/prisma.js";
import crypto from "crypto";
import { logger } from "../../../utils/logger.js";
import { z } from "zod";
import type {
  IntelligentContextResult,
  IntelligentGenerationConfig,
} from "./integrationHelpers.js";

// ============================================================================
// Types
// ============================================================================

export interface CachedContext extends IntelligentContextResult {
  /** Date de mise en cache */
  cachedAt: Date;
  /** Hash des pages pour validation */
  pageHashes: Record<string, string>;
  /** Configuration utilisée */
  config: IntelligentGenerationConfig;
}

export interface ContextCacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

const CachedContextSchema = z
  .object({
    enrichedRagContext: z.string(),
    questionDistribution: z.array(
      z.object({
        clusterId: z.string(),
        clusterName: z.string(),
        keywords: z.array(z.string()),
        questionCount: z.number(),
        content: z.string(),
        pageIds: z.array(z.string()),
      }),
    ),
    clusters: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        pageCount: z.number(),
        keywords: z.array(z.string()),
        importance: z.number(),
      }),
    ),
    processingTimeMs: z.number(),
    stats: z.object({
      totalPages: z.number(),
      totalClusters: z.number(),
      totalTokens: z.number(),
      contentTypes: z.record(z.number()),
    }),

    cachedAt: z.coerce.date(),
    pageHashes: z.record(z.string()),
    config: z.object({
      enabled: z.boolean(),
      maxTokens: z.number().optional(),
      balanceContentTypes: z.boolean().optional(),
      generateClusterNames: z.boolean().optional(),
      minPagesForClustering: z.number().optional(),
    }),
  })
  .passthrough() satisfies z.ZodType<CachedContext>;

function parseCachedContext(raw: string): CachedContext | null {
  try {
    const parsedUnknown: unknown = JSON.parse(raw);
    const parsed = CachedContextSchema.safeParse(parsedUnknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Configuration
// ============================================================================

/** TTL du cache: 24 heures */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

/** Préfixe pour les clés de cache */
const CACHE_PREFIX = "quiz-context";

// ============================================================================
// ContextCacheService
// ============================================================================

export class ContextCacheService {
  /**
   * Génère une clé de cache basée sur les pages, la configuration ET le ragContext
   */
  static generateCacheKey(
    pageIds: string[],
    questionCount: number,
    config: Partial<IntelligentGenerationConfig> = {},
    ragContext?: string,
  ): string {
    // Trier les pageIds pour garantir la même clé peu importe l'ordre
    const sortedPageIds = [...pageIds].sort().join("|");

    // Extraire les paramètres significatifs de la config
    const configParams = {
      maxTokens: config.maxTokens ?? 8000,
      balanceContentTypes: config.balanceContentTypes ?? true,
    };

    // Hash du ragContext pour l'inclure dans la clé
    // Si le ragContext change, on veut un nouveau cache
    const ragContextHash = ragContext
      ? crypto.createHash("md5").update(ragContext).digest("hex").slice(0, 8)
      : "no-rag";

    // Créer un hash court pour la clé
    const dataToHash = JSON.stringify({
      pages: sortedPageIds,
      questionCount,
      config: configParams,
      ragContext: ragContextHash,
    });

    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex").slice(0, 16);

    return `${CACHE_PREFIX}:${hash}`;
  }

  /**
   * Récupère le contexte depuis le cache s'il est valide
   */
  static async getCachedContext(cacheKey: string): Promise<CachedContext | null> {
    try {
      const cached = await redis.get(cacheKey);

      if (!cached) {
        logger.log(`❌ [CONTEXT-CACHE] MISS: ${cacheKey}`);
        return null;
      }

      const parsed = parseCachedContext(cached);
      if (!parsed) {
        logger.log(`⚠️ [CONTEXT-CACHE] Cache invalide (parse): ${cacheKey}`);
        return null;
      }

      logger.log(`✅ [CONTEXT-CACHE] HIT: ${cacheKey}`);
      return parsed;
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur lecture:`, error);
      return null;
    }
  }

  /**
   * Vérifie si le cache est encore valide (pages non modifiées)
   */
  static async isContextValid(cached: CachedContext, pageIds: string[]): Promise<boolean> {
    try {
      // Vérifier que toutes les pages sont toujours là
      if (pageIds.length !== Object.keys(cached.pageHashes).length) {
        logger.log(`⚠️ [CONTEXT-CACHE] Nombre de pages différent`);
        return false;
      }

      // Récupérer les dates de modification des pages
      const pages = await prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, updatedAt: true },
      });

      // Vérifier que chaque page n'a pas été modifiée
      for (const page of pages) {
        const cachedHash = cached.pageHashes[page.id];
        const currentHash = this.hashPageTimestamp(page.updatedAt);

        if (cachedHash !== currentHash) {
          logger.log(`⚠️ [CONTEXT-CACHE] Page ${page.id} modifiée depuis le cache`);
          return false;
        }
      }

      logger.log(`✅ [CONTEXT-CACHE] Cache valide`);
      return true;
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur validation:`, error);
      return false; // En cas d'erreur, invalider le cache
    }
  }

  /**
   * Stocke le contexte dans le cache
   */
  static async cacheContext(
    cacheKey: string,
    context: IntelligentContextResult,
    pageIds: string[],
    config: IntelligentGenerationConfig,
  ): Promise<boolean> {
    try {
      // Récupérer les timestamps des pages pour validation future
      const pages = await prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, updatedAt: true },
      });

      const pageHashes: Record<string, string> = {};
      for (const page of pages) {
        pageHashes[page.id] = this.hashPageTimestamp(page.updatedAt);
      }

      const cachedContext: CachedContext = {
        ...context,
        cachedAt: new Date(),
        pageHashes,
        config,
      };

      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(cachedContext));

      logger.log(`💾 [CONTEXT-CACHE] Stocké: ${cacheKey} (TTL: ${CACHE_TTL_SECONDS}s)`);
      return true;
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur stockage:`, error);
      return false;
    }
  }

  /**
   * Invalide le cache pour des pages spécifiques
   * À appeler quand une page est modifiée
   */
  static async invalidateForPages(pageIds: string[]): Promise<number> {
    try {
      // Récupérer toutes les clés de cache quiz-context
      const keys = await redis.keys(`${CACHE_PREFIX}:*`);

      if (keys.length === 0) {
        return 0;
      }

      let invalidatedCount = 0;

      for (const key of keys) {
        try {
          const cached = await redis.get(key);
          if (!cached) continue;

          const parsed = parseCachedContext(cached);
          if (!parsed) continue;

          // Vérifier si une des pages modifiées est dans ce cache
          const hasAffectedPage = pageIds.some((pageId) => pageId in parsed.pageHashes);

          if (hasAffectedPage) {
            await redis.del(key);
            invalidatedCount++;
            logger.log(`🗑️ [CONTEXT-CACHE] Invalidé: ${key}`);
          }
        } catch {
          // Ignorer les erreurs de parsing pour les clés individuelles
        }
      }

      if (invalidatedCount > 0) {
        logger.log(
          `🗑️ [CONTEXT-CACHE] ${invalidatedCount} cache(s) invalidé(s) pour pages: ${pageIds.join(", ")}`,
        );
      }

      return invalidatedCount;
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur invalidation:`, error);
      return 0;
    }
  }

  /**
   * Invalide tout le cache de contexte
   */
  static async invalidateAll(): Promise<number> {
    try {
      const keys = await redis.keys(`${CACHE_PREFIX}:*`);

      if (keys.length === 0) {
        return 0;
      }

      await redis.del(...keys);
      logger.log(`🗑️ [CONTEXT-CACHE] Tous les caches invalidés (${keys.length})`);
      return keys.length;
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur invalidation totale:`, error);
      return 0;
    }
  }

  /**
   * Récupère ou génère le contexte (pattern cache-aside)
   */
  static async getOrPrepareContext(
    pageIds: string[],
    questionCount: number,
    config: IntelligentGenerationConfig,
    prepareFunction: () => Promise<IntelligentContextResult | null>,
    ragContext?: string,
  ): Promise<{ context: IntelligentContextResult | null; fromCache: boolean }> {
    const cacheKey = this.generateCacheKey(pageIds, questionCount, config, ragContext);

    // 1. Essayer de récupérer depuis le cache
    const cached = await this.getCachedContext(cacheKey);

    if (cached) {
      // 2. Valider que le cache est encore frais
      const isValid = await this.isContextValid(cached, pageIds);

      if (isValid) {
        logger.log(`⚡ [CONTEXT-CACHE] Utilisation du cache`);
        return { context: cached, fromCache: true };
      } else {
        logger.log(`🔄 [CONTEXT-CACHE] Cache invalide, régénération...`);
      }
    }

    // 3. Générer le contexte frais
    logger.log(`🔄 [CONTEXT-CACHE] Préparation du contexte...`);
    const freshContext = await prepareFunction();

    // 4. Stocker en cache si contexte valide
    if (freshContext) {
      await this.cacheContext(cacheKey, freshContext, pageIds, config);
    }

    return { context: freshContext, fromCache: false };
  }

  /**
   * Statistiques du cache (pour monitoring)
   */
  static async getCacheStats(): Promise<{
    totalKeys: number;
    oldestCache: Date | null;
    newestCache: Date | null;
  }> {
    try {
      const keys = await redis.keys(`${CACHE_PREFIX}:*`);

      if (keys.length === 0) {
        return { totalKeys: 0, oldestCache: null, newestCache: null };
      }

      let oldest: Date | null = null;
      let newest: Date | null = null;

      for (const key of keys.slice(0, 10)) {
        // Limiter pour perf
        try {
          const cached = await redis.get(key);
          if (cached) {
            const parsed = parseCachedContext(cached);
            if (!parsed) continue;
            const cachedAt = parsed.cachedAt;

            if (!oldest || cachedAt < oldest) oldest = cachedAt;
            if (!newest || cachedAt > newest) newest = cachedAt;
          }
        } catch {
          // Ignorer
        }
      }

      return {
        totalKeys: keys.length,
        oldestCache: oldest,
        newestCache: newest,
      };
    } catch (error) {
      logger.error(`⚠️ [CONTEXT-CACHE] Erreur stats:`, error);
      return { totalKeys: 0, oldestCache: null, newestCache: null };
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Génère un hash court du timestamp de modification d'une page
   */
  private static hashPageTimestamp(updatedAt: Date): string {
    return crypto.createHash("md5").update(updatedAt.toISOString()).digest("hex").slice(0, 8);
  }
}

// ============================================================================
// Exports
// ============================================================================
