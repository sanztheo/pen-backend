import { prisma } from '../../lib/prisma.js';

// Types pour le gestionnaire de quotas
interface QuotaUsage {
  requests: number;
  tokens: number;
  cost: number;
  windowStart: Date;
}

interface QuotaLimits {
  maxRequests: number;
  maxTokens: number;
  maxCost: number;
  windowDurationMs: number;
}

/**
 * 🛡️ Gestionnaire de quotas OpenAI pour éviter les dépassements
 */
export class OpenAIQuotaManager {
  private static quotaCache = new Map<string, QuotaUsage>();
  

  /**
   * Obtenir les limites configurées pour l'environnement
   */
  private static getLimits(): QuotaLimits {
    return {
      maxRequests: parseInt(process.env.OPENAI_MAX_REQUESTS_PER_HOUR || '1000'),
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS_PER_HOUR || '500000'),
      maxCost: parseFloat(process.env.OPENAI_MAX_COST_PER_HOUR || '10.0'),
      windowDurationMs: parseInt(process.env.OPENAI_QUOTA_WINDOW_MS || '3600000') // 1h
    };
  }

  /**
   * Calculer le coût approximatif d'une requête
   */
  private static calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Prix approximatifs par 1K tokens (à jour 2024)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'gpt-3.5-turbo-16k': { input: 0.003, output: 0.004 }
    };

    const modelPricing = pricing[model] || pricing['gpt-3.5-turbo']; // fallback
    return (promptTokens / 1000 * modelPricing.input) + (completionTokens / 1000 * modelPricing.output);
  }

  /**
   * Obtenir l'usage actuel depuis le cache ou la DB
   */
  private static async getCurrentUsage(key: string = 'global'): Promise<QuotaUsage> {
    const now = new Date();
    const limits = this.getLimits();

    // Vérifier le cache
    const cached = this.quotaCache.get(key);
    if (cached && (now.getTime() - cached.windowStart.getTime()) < limits.windowDurationMs) {
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
            gte: windowStart
          }
        },
        select: {
          promptTokens: true,
          completionTokens: true,
          estimatedCost: true
        }
      });

      const result: QuotaUsage = {
        requests: usageRecords.length,
        tokens: usageRecords.reduce((sum, record) => sum + record.promptTokens + record.completionTokens, 0),
        cost: usageRecords.reduce((sum, record) => sum + record.estimatedCost, 0),
        windowStart: windowStart
      };

      this.quotaCache.set(key, result);
      console.log(`📊 [QUOTA] Usage depuis DB: ${result.requests} requêtes, ${result.tokens} tokens, $${result.cost.toFixed(4)}`);
      return result;

    } catch (error) {
      // Si la table n'existe pas, utiliser cache en mémoire uniquement
      console.warn('⚠️ Table openai_usage_log introuvable, utilisation cache mémoire:', error);
      
      const result: QuotaUsage = {
        requests: 0,
        tokens: 0,
        cost: 0,
        windowStart: windowStart
      };

      this.quotaCache.set(key, result);
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
    quotaKey: string = 'global'
  ): Promise<{ allowed: boolean; reason?: string; usage?: QuotaUsage; limits?: QuotaLimits }> {
    
    const limits = this.getLimits();
    const usage = await this.getCurrentUsage(quotaKey);
    
    const estimatedCost = this.calculateCost(model, estimatedPromptTokens, estimatedCompletionTokens);

    // Vérifications des limites
    if (usage.requests >= limits.maxRequests) {
      return {
        allowed: false,
        reason: `Limite de requêtes atteinte (${usage.requests}/${limits.maxRequests} par heure)`,
        usage,
        limits
      };
    }

    if (usage.tokens + estimatedPromptTokens + estimatedCompletionTokens >= limits.maxTokens) {
      return {
        allowed: false,
        reason: `Limite de tokens atteinte (${usage.tokens + estimatedPromptTokens + estimatedCompletionTokens}/${limits.maxTokens} par heure)`,
        usage,
        limits
      };
    }

    if (usage.cost + estimatedCost >= limits.maxCost) {
      return {
        allowed: false,
        reason: `Limite de coût atteinte ($${(usage.cost + estimatedCost).toFixed(4)}/$${limits.maxCost} par heure)`,
        usage,
        limits
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
    quotaKey: string = 'global'
  ): Promise<void> {
    console.log(`📝 [QUOTA] recordUsage() appelée:`, {
      model,
      promptTokens,
      completionTokens,
      quotaKey
    });
    
    const cost = this.calculateCost(model, promptTokens, completionTokens);
    const totalTokens = promptTokens + completionTokens;

    // Mettre à jour le cache
    const usage = await this.getCurrentUsage(quotaKey);
    usage.requests += 1;
    usage.tokens += totalTokens;
    usage.cost += cost;
    this.quotaCache.set(quotaKey, usage);

    // Enregistrer en DB si possible
    try {
      console.log(`💾 [QUOTA] Tentative d'enregistrement en DB:`, {
        quotaKey,
        model,
        promptTokens,
        completionTokens,
        estimatedCost: cost
      });
      
      // Vérifier si le modèle openaiUsageLog existe
      if (!prisma.openaiUsageLog) {
        throw new Error('Modèle openaiUsageLog non trouvé dans le client Prisma - régénération requise');
      }
      
      await prisma.openaiUsageLog.create({
        data: {
          quotaKey,
          model,
          promptTokens,
          completionTokens,
          estimatedCost: cost,
          createdAt: new Date()
        }
      });
      console.log(`✅ [QUOTA] Usage enregistré en DB: ${model} - ${totalTokens} tokens - $${cost.toFixed(4)}`);
    } catch (error) {
      console.error('❌ [QUOTA] Erreur enregistrement DB:', error);
      console.log('💾 Cache mémoire utilisé pour l\'usage OpenAI - Client Prisma doit être régénéré !');
    }
  }

  /**
   * Obtenir les statistiques d'usage actuelles
   */
  static async getUsageStats(quotaKey: string = 'global'): Promise<{
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
        cost: Math.round((usage.cost / limits.maxCost) * 100)
      },
      remainingTime: limits.windowDurationMs - (Date.now() - usage.windowStart.getTime())
    };
  }

  /**
   * Forcer le reset du cache (pour les tests)
   */
  static resetCache(): void {
    this.quotaCache.clear();
  }
}