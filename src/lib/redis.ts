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
 * Cache Workspace avec TTL 10 minutes
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
      await redis.setex(cacheKey, 600, JSON.stringify(workspace)); // 10min TTL
    }

    return workspace;
  } catch (error) {
    console.error('⚠️ [REDIS] Fallback to DB (cache error):', error);
    return await prisma.workspace.findFirst({ where: { id: workspaceId } });
  }
};

/**
 * Cache Project avec TTL 10 minutes
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
      await redis.setex(cacheKey, 600, JSON.stringify(project)); // 10min TTL
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
 * Cache BlockNote Content avec TTL 2 minutes
 * TTL court car le contenu est édité fréquemment
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
      // TTL 2min (120s) car contenu éditable fréquemment
      await redis.setex(cacheKey, 120, JSON.stringify(page));
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
 * Cache Active RAG Session avec TTL 5 minutes
 * TTL court car session change fréquemment
 */
export const cacheActiveRAGSession = async (userId: string, workspaceId: string) => {
  try {
    const cacheKey = `rag-session:${userId}:${workspaceId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      console.log(`✅ [REDIS-CACHE] RAG Session HIT: ${userId}/${workspaceId}`);
      return JSON.parse(cached);
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
      await redis.setex(cacheKey, 300, JSON.stringify(session)); // 5min TTL
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
