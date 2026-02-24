/**
 * FIX-10: Rate limit burst AI - 10 req / 60s par userId
 * Protection contre les rafales de requetes AI
 */

import rateLimit from "express-rate-limit";
import { Request } from "express";
import { getRateLimitStoreWithFallback } from "../config/rateLimitStore.js";

const getIpKey = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : req.socket.remoteAddress || "unknown";
};

export const aiBurstRateLimit = rateLimit({
  store: getRateLimitStoreWithFallback("rl:ai-burst:"),
  windowMs: 60_000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "AI_BURST_LIMIT_EXCEEDED",
    message: "Trop de requêtes IA en peu de temps. Veuillez patienter quelques secondes.",
    retryAfter: "60 seconds",
  },
  keyGenerator: (req) => {
    const userId = req.user?.id;
    return userId ? `user_${userId}` : `ip_${getIpKey(req)}`;
  },
  skip: () => process.env.RATE_LIMIT_ENABLED === "false",
});
