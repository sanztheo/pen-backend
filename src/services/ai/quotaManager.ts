import { prisma } from "../../lib/prisma.js";
import { cacheQuotaUsage, invalidateQuotaUsageCache } from "../../lib/redis.js";
import { logger } from "../../utils/logger.js";
import { getModelPricing } from "../../config/models.js";

// Types pour le gestionnaire de quotas
interface QuotaUsage {
  requests: number;
  tokens: number;
  cost: number;
  windowStart: Date;
}

interface CachedQuotaUsage extends QuotaUsage {
  cachedAt: number;
}

interface QuotaLimits {
  maxRequests: number;
  maxTokens: number;
  maxCost: number;
  windowDurationMs: number;
}

/**
 * 🛡️ Gestionnaire de quotas AI (tous providers) pour éviter les dépassements
 */
export class AIQuotaManager {
  private static quotaCache = new Map<string, CachedQuotaUsage>();
  private static readonly CACHE_TTL_MS = 120_000;

  /**
   * Obtenir les limites configurées pour l'environnement
   */
  private static getLimits(): QuotaLimits {
    return {
      maxRequests: parseInt(
        process.env.AI_MAX_REQUESTS_PER_HOUR || process.env.OPENAI_MAX_REQUESTS_PER_HOUR || "1000",
      ),
      maxTokens: parseInt(
        process.env.AI_MAX_TOKENS_PER_HOUR || process.env.OPENAI_MAX_TOKENS_PER_HOUR || "500000",
      ),
      maxCost: parseFloat(
        process.env.AI_MAX_COST_PER_HOUR || process.env.OPENAI_MAX_COST_PER_HOUR || "10.0",
      ),
      windowDurationMs: parseInt(
        process.env.AI_QUOTA_WINDOW_MS || process.env.OPENAI_QUOTA_WINDOW_MS || "3600000",
      ), // 1h
    };
  }

  /**
   * Calculer le coût approximatif d'une requête
   */
  private static calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const modelPricing = getModelPricing(model);
    return (
      (promptTokens / 1000) * modelPricing.input + (completionTokens / 1000) * modelPricing.output
    );
  }

  /**
   * Obtenir l'usage actuel depuis Redis cache ou la DB
   */
  private static pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.quotaCache) {
      if (now - entry.cachedAt > this.CACHE_TTL_MS) {
        this.quotaCache.delete(key);
      }
    }
  }

  private static async getCurrentUsage(key: string = "global"): Promise<QuotaUsage> {
    this.pruneExpiredEntries();
    const now = new Date();
    const limits = this.getLimits();

    // 🚀 REDIS CACHE: Récupérer depuis cache (2min TTL)
    const redisUsage = await cacheQuotaUsage(key);
    if (redisUsage) {
      this.quotaCache.set(key, { ...redisUsage, cachedAt: Date.now() });
      return redisUsage;
    }

    // Vérifier le cache mémoire si Redis échoue
    const cached = this.quotaCache.get(key);
    if (
      cached &&
      Date.now() - cached.cachedAt < this.CACHE_TTL_MS &&
      now.getTime() - cached.windowStart.getTime() < limits.windowDurationMs
    ) {
      return cached;
    }

    // Calculer le début de la fenêtre actuelle
    const windowStart = new Date(now.getTime() - limits.windowDurationMs);

    try {
      // Récupérer depuis la DB avec le client Prisma
      const usageRecords = await prisma.openaiUsageLog.findMany({
        where: {
          quotaKey: key,
          createdAt: {
            gte: windowStart,
          },
        },
        select: {
          promptTokens: true,
          completionTokens: true,
          estimatedCost: true,
        },
      });

      const result: QuotaUsage = {
        requests: usageRecords.length,
        tokens: usageRecords.reduce(
          (sum, record) => sum + record.promptTokens + record.completionTokens,
          0,
        ),
        cost: usageRecords.reduce((sum, record) => sum + record.estimatedCost, 0),
        windowStart: windowStart,
      };

      this.quotaCache.set(key, { ...result, cachedAt: Date.now() });
      logger.log(
        `📊 [QUOTA] Usage depuis DB: ${result.requests} requêtes, ${result.tokens} tokens, $${result.cost.toFixed(4)}`,
      );
      return result;
    } catch (error) {
      // Si la table n'existe pas, utiliser cache en mémoire uniquement
      logger.warn("⚠️ Table openai_usage_log introuvable, utilisation cache mémoire:", error);

      const result: QuotaUsage = {
        requests: 0,
        tokens: 0,
        cost: 0,
        windowStart: windowStart,
      };

      this.quotaCache.set(key, { ...result, cachedAt: Date.now() });
      return result;
    }
  }

  /**
   * Vérifier si une requête est autorisée
   */
  static async checkQuota(
    model: string,
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number,
    quotaKey: string = "global",
  ): Promise<{ allowed: boolean; reason?: string; usage?: QuotaUsage; limits?: QuotaLimits }> {
    const limits = this.getLimits();
    const usage = await this.getCurrentUsage(quotaKey);

    const estimatedCost = this.calculateCost(
      model,
      estimatedPromptTokens,
      estimatedCompletionTokens,
    );

    // Vérifications des limites
    if (usage.requests >= limits.maxRequests) {
      return {
        allowed: false,
        reason: `Limite de requêtes atteinte (${usage.requests}/${limits.maxRequests} par heure)`,
        usage,
        limits,
      };
    }

    if (usage.tokens + estimatedPromptTokens + estimatedCompletionTokens >= limits.maxTokens) {
      return {
        allowed: false,
        reason: `Limite de tokens atteinte (${usage.tokens + estimatedPromptTokens + estimatedCompletionTokens}/${limits.maxTokens} par heure)`,
        usage,
        limits,
      };
    }

    if (usage.cost + estimatedCost >= limits.maxCost) {
      return {
        allowed: false,
        reason: `Limite de coût atteinte ($${(usage.cost + estimatedCost).toFixed(4)}/$${limits.maxCost} par heure)`,
        usage,
        limits,
      };
    }

    return { allowed: true, usage, limits };
  }

  /**
   * Enregistrer l'usage d'une requête
   */
  static async recordUsage(
    model: string,
    promptTokens: number,
    completionTokens: number,
    quotaKey: string = "global",
    userId?: string,
    source?: string,
  ): Promise<void> {
    logger.log(`📝 [QUOTA] recordUsage() appelée:`, {
      model,
      promptTokens,
      completionTokens,
      quotaKey,
      userId,
      source,
    });

    const cost = this.calculateCost(model, promptTokens, completionTokens);
    const totalTokens = promptTokens + completionTokens;

    // Mettre à jour le cache
    const usage = await this.getCurrentUsage(quotaKey);
    usage.requests += 1;
    usage.tokens += totalTokens;
    usage.cost += cost;
    this.quotaCache.set(quotaKey, { ...usage, cachedAt: Date.now() });

    // Enregistrer en DB si possible
    try {
      logger.log(`💾 [QUOTA] Tentative d'enregistrement en DB:`, {
        quotaKey,
        model,
        promptTokens,
        completionTokens,
        estimatedCost: cost,
      });

      // Vérifier si le modèle openaiUsageLog existe
      if (!prisma.openaiUsageLog) {
        throw new Error(
          "Modèle openaiUsageLog non trouvé dans le client Prisma - régénération requise",
        );
      }

      await prisma.openaiUsageLog.create({
        data: {
          quotaKey,
          userId,
          model,
          promptTokens,
          completionTokens,
          estimatedCost: cost,
          source,
          createdAt: new Date(),
        },
      });
      logger.log(
        `✅ [QUOTA] Usage enregistré en DB: ${model} - ${totalTokens} tokens - $${cost.toFixed(4)}`,
      );

      // 🗑️ INVALIDER CACHE REDIS après enregistrement
      invalidateQuotaUsageCache(quotaKey).catch((err) =>
        logger.error("⚠️ [REDIS] Erreur invalidation cache Quota:", err),
      );
    } catch (error) {
      logger.error("❌ [QUOTA] Erreur enregistrement DB:", error);
      logger.log("💾 Cache mémoire utilisé pour l'usage AI - Client Prisma doit être régénéré !");
    }
  }

  /**
   * Obtenir les statistiques d'usage actuelles
   */
  static async getUsageStats(quotaKey: string = "global"): Promise<{
    usage: QuotaUsage;
    limits: QuotaLimits;
    percentages: { requests: number; tokens: number; cost: number };
    remainingTime: number;
  }> {
    const usage = await this.getCurrentUsage(quotaKey);
    const limits = this.getLimits();

    return {
      usage,
      limits,
      percentages: {
        requests: Math.round((usage.requests / limits.maxRequests) * 100),
        tokens: Math.round((usage.tokens / limits.maxTokens) * 100),
        cost: Math.round((usage.cost / limits.maxCost) * 100),
      },
      remainingTime: limits.windowDurationMs - (Date.now() - usage.windowStart.getTime()),
    };
  }

  /**
   * Forcer le reset du cache (pour les tests)
   */
  static resetCache(): void {
    this.quotaCache.clear();
  }
}
