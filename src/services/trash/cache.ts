import { invalidateSidebarCache } from "../../lib/redis.js";
import { logger } from "../../utils/logger.js";
import { redisCache } from "../cache/redisCache.js";

/**
 * Fire-and-forget Redis invalidation for the two caches that can serve stale
 * trash/sidebar state to a user. Soft-fails on its own so a Redis outage can
 * never block the trash flow.
 */
export async function invalidateUserCaches(userId: string | undefined): Promise<void> {
  if (!userId) return;
  await Promise.all([
    invalidateSidebarCache(userId).catch((err) =>
      logger.warn("[TRASH] sidebar cache invalidation failed", { userId, err }),
    ),
    redisCache
      .invalidatePattern(`recent-pages:${userId}:*`, { namespace: "pages" })
      .catch((err) =>
        logger.warn("[TRASH] recent-pages cache invalidation failed", { userId, err }),
      ),
  ]);
}
