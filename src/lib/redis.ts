import { Redis } from 'ioredis';
import { prisma } from './prisma.js';

// 🚀 Configuration Redis avec fallback gracieux
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Créer instance Redis avec retry automatique
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err) {
    console.error('❌ [REDIS] Erreur connexion:', err.message);
    return true; // Toujours tenter de reconnecter
  }
});

// Events logging
redis.on('connect', () => {
  console.log('✅ [REDIS] Connexion établie');
});

redis.on('error', (err) => {
  console.error('❌ [REDIS] Erreur:', err.message);
});

redis.on('ready', () => {
  console.log('🚀 [REDIS] Prêt à recevoir des commandes');
});

// ============================================
// 🎯 CACHE FUNCTIONS
// ============================================

/**
 * Cache UserLimits avec TTL 5 minutes
 * Évite les requêtes DB répétées pour vérifier les limites
 */
export const cacheUserLimits = async (userId: string) => {
  try {
    const cacheKey = `limits:${userId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] UserLimits HIT: ${userId}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] UserLimits MISS: ${userId}`);
    const limits = await prisma.userLimits.findUnique({ where: { userId } });

    if (limits) {
      await redis.setex(cacheKey, 300, JSON.stringify(limits)); // 5min TTL
    }

    return limits;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return await prisma.userLimits.findUnique({ where: { userId } });
  }
};

/**
 * Invalider le cache UserLimits (après update)
 */
export const invalidateUserLimitsCache = async (userId: string) => {
  try {
    await redis.del(`limits:${userId}`);
    console.log(`🗑️ [REDIS-CACHE] UserLimits invalidated: ${userId}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache:', error);
  }
};

/**
 * Cache Workspace avec TTL 1 heure
 * Optimisé pour usage mono-utilisateur sans collaboration
 */
export const cacheWorkspace = async (workspaceId: string) => {
  try {
    const cacheKey = `workspace:${workspaceId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] Workspace HIT: ${workspaceId}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] Workspace MISS: ${workspaceId}`);
    const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId } });

    if (workspace) {
      await redis.setex(cacheKey, 3600, JSON.stringify(workspace)); // 1h TTL
    }

    return workspace;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return await prisma.workspace.findFirst({ where: { id: workspaceId } });
  }
};

/**
 * Cache Project avec TTL 1 heure
 * Optimisé pour usage mono-utilisateur sans collaboration
 */
export const cacheProject = async (projectId: string, userId: string) => {
  try {
    const cacheKey = `project:${projectId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] Project HIT: ${projectId}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] Project MISS: ${projectId}`);
    const project = await prisma.project.findFirst({
      where: { id: projectId, createdBy: userId },
      select: { id: true, workspaceId: true, name: true }
    });

    if (project) {
      await redis.setex(cacheKey, 3600, JSON.stringify(project)); // 1h TTL
    }

    return project;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return await prisma.project.findFirst({
      where: { id: projectId, createdBy: userId },
      select: { id: true, workspaceId: true, name: true }
    });
  }
};

/**
 * Cache DefaultWorkspace avec TTL 1 heure (rarement change)
 */
export const cacheDefaultWorkspaceId = async (userId: string): Promise<string | null> => {
  try {
    const cacheKey = `default-workspace:${userId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] DefaultWorkspace HIT: ${userId}`);
      return cached;
    }

    console.log(`❌ [REDIS-CACHE] DefaultWorkspace MISS: ${userId}`);
    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId, isActive: true } } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    if (workspace?.id) {
      await redis.setex(cacheKey, 3600, workspace.id); // 1h TTL
      return workspace.id;
    }

    return null;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    const workspace = await prisma.workspace.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId, isActive: true } } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });
    return workspace?.id || null;
  }
};

/**
 * Vider tous les caches d'un utilisateur
 */
export const clearUserCache = async (userId: string) => {
  try {
    const keys = await redis.keys(`*:${userId}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ [REDIS-CACHE] Cleared ${keys.length} keys for user ${userId}`);
    }
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur nettoyage cache:', error);
  }
};

/**
 * Cache BlockNote Content avec TTL 24 heures
 * TTL long car invalidation automatique à chaque sauvegarde (pas de collaboration)
 * Performance optimale: données en cache jusqu'à modification utilisateur
 */
export const cacheBlockNoteContent = async (pageId: string) => {
  try {
    const cacheKey = `blocknote:${pageId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] BlockNote HIT: ${pageId}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] BlockNote MISS: ${pageId}`);
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      select: {
        id: true,
        title: true,
        blockNoteContent: true
      }
    } as any);

    if (page) {
      // TTL 24h (86400s) - invalidé à chaque sauvegarde WebSocket
      await redis.setex(cacheKey, 86400, JSON.stringify(page));
    }

    return page;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return await prisma.page.findUnique({
      where: { id: pageId },
      select: {
        id: true,
        title: true,
        blockNoteContent: true
      }
    } as any);
  }
};

/**
 * Invalider le cache BlockNote (après sauvegarde)
 */
export const invalidateBlockNoteCache = async (pageId: string) => {
  try {
    await redis.del(`blocknote:${pageId}`);
    console.log(`🗑️ [REDIS-CACHE] BlockNote invalidated: ${pageId}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache BlockNote:', error);
  }
};

/**
 * 🔧 Helper: Reconvertir les dates après désérialisation JSON
 * JSON.parse() convertit les dates en strings, on doit les reconvertir en Date
 */
const deserializeRAGSession = (session: any) => {
  if (!session) return null;

  return {
    ...session,
    createdAt: session.createdAt ? new Date(session.createdAt) : null,
    updatedAt: session.updatedAt ? new Date(session.updatedAt) : null,
    lastQueryAt: session.lastQueryAt ? new Date(session.lastQueryAt) : null,
    sourcesUsed: session.sourcesUsed?.map((source: any) => ({
      ...source,
      createdAt: source.createdAt ? new Date(source.createdAt) : null,
      updatedAt: source.updatedAt ? new Date(source.updatedAt) : null
    })) || []
  };
};

/**
 * Cache Active RAG Session avec TTL 15 minutes
 * Optimisé pour usage mono-utilisateur (invalidation lors des updates)
 */
export const cacheActiveRAGSession = async (userId: string, workspaceId: string) => {
  try {
    const cacheKey = `rag-session:${userId}:${workspaceId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] RAG Session HIT: ${userId}/${workspaceId}`);
      const parsedSession = JSON.parse(cached);
      return deserializeRAGSession(parsedSession); // 🔧 FIX: Reconvertir les dates
    }

    console.log(`❌ [REDIS-CACHE] RAG Session MISS: ${userId}/${workspaceId}`);
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const session = await prisma.rAGSession.findFirst({
      where: {
        userId,
        workspaceId,
        lastQueryAt: { gte: cutoffTime }
      },
      orderBy: { lastQueryAt: 'desc' },
      include: { sourcesUsed: true }
    });

    if (session) {
      await redis.setex(cacheKey, 900, JSON.stringify(session)); // 15min TTL
    }

    return session;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return await prisma.rAGSession.findFirst({
      where: {
        userId,
        workspaceId,
        lastQueryAt: { gte: cutoffTime }
      },
      orderBy: { lastQueryAt: 'desc' },
      include: { sourcesUsed: true }
    });
  }
};

/**
 * Invalider le cache RAG Session (après update)
 */
export const invalidateRAGSessionCache = async (userId: string, workspaceId: string) => {
  try {
    await redis.del(`rag-session:${userId}:${workspaceId}`);
    console.log(`🗑️ [REDIS-CACHE] RAG Session invalidated: ${userId}/${workspaceId}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache RAG Session:', error);
  }
};

/**
 * Cache OpenAI Quota Usage avec TTL 2 minutes
 * TTL court pour éviter dépassements de quota
 */
export const cacheQuotaUsage = async (quotaKey: string = 'global') => {
  try {
    const cacheKey = `quota-usage:${quotaKey}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] Quota Usage HIT: ${quotaKey}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] Quota Usage MISS: ${quotaKey}`);
    const now = new Date();
    const windowStart = new Date(now.getTime() - 3600000); // 1h window

    const usageRecords = await prisma.openaiUsageLog.findMany({
      where: {
        quotaKey,
        createdAt: { gte: windowStart }
      },
      select: {
        promptTokens: true,
        completionTokens: true,
        estimatedCost: true
      }
    });

    const result = {
      requests: usageRecords.length,
      tokens: usageRecords.reduce((sum, record) => sum + record.promptTokens + record.completionTokens, 0),
      cost: usageRecords.reduce((sum, record) => sum + record.estimatedCost, 0),
      windowStart: windowStart
    };

    if (usageRecords.length > 0) {
      await redis.setex(cacheKey, 120, JSON.stringify(result)); // 2min TTL
    }

    return result;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to memory (cache error):', error);
    return null; // Fallback to in-memory cache in quotaManager
  }
};

/**
 * Invalider le cache Quota Usage (après enregistrement)
 */
export const invalidateQuotaUsageCache = async (quotaKey: string = 'global') => {
  try {
    await redis.del(`quota-usage:${quotaKey}`);
    console.log(`🗑️ [REDIS-CACHE] Quota Usage invalidated: ${quotaKey}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache Quota:', error);
  }
};

/**
 * Cache Sidebar Content avec TTL 5 minutes
 * Optimisé pour éviter le rechargement lors du retour depuis PricingPage
 */
export const cacheSidebarContent = async (userId: string) => {
  try {
    const cacheKey = `sidebar:${userId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] Sidebar HIT: ${userId}`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] Sidebar MISS: ${userId}`);
    return null; // Retourner null si pas en cache
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return null;
  }
};

/**
 * Sauvegarder le contenu de la sidebar dans le cache
 */
export const saveSidebarContent = async (userId: string, content: any) => {
  try {
    const cacheKey = `sidebar:${userId}`;
    await redis.setex(cacheKey, 300, JSON.stringify(content)); // 5min TTL
    console.log(`💾 [REDIS-CACHE] Sidebar sauvegardé: ${userId}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur sauvegarde sidebar:', error);
  }
};

/**
 * Invalider le cache Sidebar (après création/suppression/modification)
 */
export const invalidateSidebarCache = async (userId: string) => {
  try {
    await redis.del(`sidebar:${userId}`);
    console.log(`🗑️ [REDIS-CACHE] Sidebar invalidated: ${userId}`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache Sidebar:', error);
  }
};

/**
 * Cache Quiz History avec TTL 2 minutes
 * TTL court pour garantir la fraîcheur des données
 */
export const cacheQuizHistory = async (userId: string, limit: number, offset: number) => {
  try {
    const cacheKey = `quiz-history:${userId}:${limit}:${offset}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] Quiz History HIT: ${userId} (limit:${limit}, offset:${offset})`);
      return JSON.parse(cached);
    }

    console.log(`❌ [REDIS-CACHE] Quiz History MISS: ${userId} (limit:${limit}, offset:${offset})`);
    return null;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return null;
  }
};

/**
 * Sauvegarder l'historique des quiz dans le cache
 */
export const saveQuizHistoryCache = async (userId: string, limit: number, offset: number, history: any) => {
  try {
    const cacheKey = `quiz-history:${userId}:${limit}:${offset}`;
    await redis.setex(cacheKey, 120, JSON.stringify(history)); // 2min TTL
    console.log(`💾 [REDIS-CACHE] Quiz History sauvegardé: ${userId} (limit:${limit}, offset:${offset})`);
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur sauvegarde quiz history:', error);
  }
};

/**
 * Invalider le cache de l'historique des quiz (après création/modification/complétion)
 */
export const invalidateQuizHistoryCache = async (userId: string) => {
  try {
    // Supprimer toutes les clés d'historique pour cet utilisateur
    const keys = await redis.keys(`quiz-history:${userId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ [REDIS-CACHE] Quiz History invalidated: ${userId} (${keys.length} clés supprimées)`);
    }
  } catch (error) {
    console.error('⚠️ [REDIS] Erreur invalidation cache Quiz History:', error);
  }
};

/**
 * Health check Redis
 */
export const redisHealthCheck = async (): Promise<boolean> => {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    console.error('❌ [REDIS] Health check failed:', error);
    return false;
  }
};
