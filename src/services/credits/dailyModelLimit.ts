import { redis } from "../../lib/redis.js";
import { logger } from "../../utils/logger.js";
import { PLAN_LIMITS } from "../../config/planLimits.js";

const DAILY_EXPENSIVE_LIMIT = PLAN_LIMITS.ultra.dailyExpensiveModelLimit;
const KEY_PREFIX = "dl:expensive:";

/** Midnight UTC timestamp (seconds). */
function midnightUnix(): number {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

// Lua script for atomic check-and-increment via redis.call (safe server-side eval, not JS eval).
// Returns [allowed (0/1), remaining].
const CHECK_AND_INCREMENT_SCRIPT = `
  local key = KEYS[1]
  local cost = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local expireat = tonumber(ARGV[3])
  local current = tonumber(redis.call('GET', key) or '0')
  if current + cost > limit then
    return {0, limit - current}
  end
  redis.call('INCRBYFLOAT', key, cost)
  redis.call('EXPIREAT', key, expireat)
  return {1, limit - current - cost}
`;

export class DailyModelLimitService {
  /** Atomic check + increment via Redis Lua. Returns whether the action is allowed. */
  static async checkAndIncrement(
    userId: string,
    creditCost: number,
  ): Promise<{ allowed: boolean; remaining: number; dailyLimit: number }> {
    try {
      const key = `${KEY_PREFIX}${userId}`;
      // redis.eval runs a Lua script server-side on Redis — this is NOT JavaScript eval()
      const result = (await redis.eval(
        CHECK_AND_INCREMENT_SCRIPT,
        1,
        key,
        creditCost,
        DAILY_EXPENSIVE_LIMIT,
        midnightUnix(),
      )) as [number, number];

      const allowed = result[0] === 1;
      const remaining = Math.max(0, result[1]);

      if (allowed) {
        logger.info(
          `[DAILY-LIMIT] Recorded ${creditCost} credits for user ${userId}, ${remaining} remaining`,
        );
      }

      return { allowed, remaining, dailyLimit: DAILY_EXPENSIVE_LIMIT };
    } catch (error) {
      // Redis failure should not block the user — fail open with warning
      logger.error("[DAILY-LIMIT] Redis error, allowing request", error);
      return { allowed: true, remaining: DAILY_EXPENSIVE_LIMIT, dailyLimit: DAILY_EXPENSIVE_LIMIT };
    }
  }

  /** Read-only check (for UI display). */
  static async checkDailyLimit(
    userId: string,
    creditCost: number,
  ): Promise<{ allowed: boolean; remaining: number; dailyLimit: number }> {
    const key = `${KEY_PREFIX}${userId}`;
    const used = parseFloat((await redis.get(key)) ?? "0");
    const remaining = DAILY_EXPENSIVE_LIMIT - used;

    return {
      allowed: used + creditCost <= DAILY_EXPENSIVE_LIMIT,
      remaining: Math.max(0, remaining),
      dailyLimit: DAILY_EXPENSIVE_LIMIT,
    };
  }
}
