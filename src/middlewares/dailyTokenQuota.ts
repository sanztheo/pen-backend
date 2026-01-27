/**
 * FIX-12: Quota quotidien AI - max 500 requetes/jour par userId (tous plans)
 * Protection ultime contre les abus prolonges
 */

import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis.js";

const MAX_DAILY_REQUESTS = 500;

/**
 * Calcule les secondes restantes jusqu'a minuit UTC
 */
const secondsUntilMidnightUTC = (): number => {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
};

/**
 * Retourne la date UTC au format YYYY-MM-DD
 */
const todayUTC = (): string => {
  return new Date().toISOString().slice(0, 10);
};

export const dailyTokenQuota = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as any).user?.id;
  if (!userId) return next();

  if (process.env.RATE_LIMIT_ENABLED === "false") return next();

  const key = `ai:daily:${userId}:${todayUTC()}`;

  try {
    const current = await redis.incr(key);

    // Set TTL on first request of the day
    if (current === 1) {
      await redis.expire(key, secondsUntilMidnightUTC());
    }

    if (current > MAX_DAILY_REQUESTS) {
      // Already incremented, but over limit - no rollback needed (counter is informational)
      const resetAt = new Date(
        Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate() + 1,
          0,
          0,
          0,
        ),
      ).toISOString();

      return res.status(429).json({
        success: false,
        error: "DAILY_AI_QUOTA_EXCEEDED",
        message: `Quota quotidien de ${MAX_DAILY_REQUESTS} requêtes IA atteint. Réinitialisation à minuit UTC.`,
        resetAt,
      });
    }

    next();
  } catch (err) {
    // Redis failure: allow request through (fail open)
    console.error("[DAILY-QUOTA] Erreur Redis:", err);
    next();
  }
};
