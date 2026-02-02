/**
 * FIX-11: Limite de concurrence AI - max 2 requetes simultanees par userId
 * Empeche un utilisateur de saturer les ressources AI
 */

import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis.js";

const MAX_CONCURRENT = 2;
const SAFETY_TTL = 300; // 5 min TTL de securite en cas de crash

export const aiConcurrencyLimit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = req.user?.id;
  if (!userId) return next();

  if (process.env.RATE_LIMIT_ENABLED === "false") return next();

  const key = `ai:concurrent:${userId}`;

  try {
    const current = await redis.incr(key);
    // Set TTL only on first increment (safety net)
    if (current === 1) {
      await redis.expire(key, SAFETY_TTL);
    }

    if (current > MAX_CONCURRENT) {
      // Rollback immediately
      await redis.decr(key);
      return res.status(429).json({
        success: false,
        error: "AI_CONCURRENCY_LIMIT",
        message: `Maximum ${MAX_CONCURRENT} requêtes IA simultanées. Veuillez attendre la fin de la requête en cours.`,
      });
    }

    // Decrement once when response finishes
    let decremented = false;
    const decrementOnce = () => {
      if (decremented) return;
      decremented = true;
      redis.decr(key).catch((err) => {
        console.error("[AI-CONCURRENCY] Erreur DECR:", err);
      });
    };

    res.on("finish", decrementOnce);
    res.on("close", decrementOnce);

    next();
  } catch (err) {
    // Redis failure: allow request through (fail open)
    console.error("[AI-CONCURRENCY] Erreur Redis:", err);
    next();
  }
};
