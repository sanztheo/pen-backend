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
