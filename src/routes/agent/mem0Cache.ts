/**
 * Mem0 search Redis cache.
 *
 * Extracted from chat.ts to keep the route handler under the 300-line budget.
 * The key includes a hash of the current query so turn N+1 can never receive
 * memories cached for turn N (PRE-MORTEM #15).
 */

import { createHash } from "crypto";
import { logger } from "../../utils/logger.js";
import { redis } from "../../lib/redis.js";
import { searchMemories } from "../../services/mem0/mem0Client.js";
import type { Mem0Memory } from "../../services/mem0/mem0Client.js";

const MEM0_CACHE_TTL_SECONDS = 600;

function buildMem0CacheKey(
  userId: string,
  conversationId: string | undefined,
  query: string,
): string {
  const hash = createHash("sha1").update(query).digest("hex").slice(0, 16);
  if (conversationId) {
    return `mem0:search:${userId}:${conversationId}:${hash}`;
  }
  return `mem0:search:${userId}:q:${hash}`;
}

export async function searchMemoriesCached(
  userId: string,
  conversationId: string | undefined,
  query: string,
): Promise<Mem0Memory[]> {
  if (!query.trim()) return [];

  const key = buildMem0CacheKey(userId, conversationId, query);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as Mem0Memory[];
    }
  } catch (err) {
    logger.warn("[MEM0_CACHE] Redis read failed, falling back to API", err);
  }

  const memories = await searchMemories(userId, query);

  // Fire-and-forget: never block the user-facing chat on a cache write.
  redis
    .setex(key, MEM0_CACHE_TTL_SECONDS, JSON.stringify(memories))
    .catch((err: unknown) => logger.warn("[MEM0_CACHE] Redis write failed", err));

  return memories;
}
