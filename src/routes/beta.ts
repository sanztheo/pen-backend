import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { authenticateToken, optionalAuth, blockImpersonation } from "../middlewares/auth.js";
import {
  betaHeartbeatRateLimit,
  betaWaitlistRateLimit,
  accountDeleteRateLimit,
  accountExportRateLimit,
} from "../middlewares/rateLimiting.js";
import {
  StatusController,
  HeartbeatController,
  WaitlistController,
  ReactivateController,
  DeleteAccountController,
  ExportAccountController,
} from "../controllers/beta/index.js";
import { BETA_LIVE } from "../config/beta.js";
import { redis } from "../lib/redis.js";
import { logger } from "../utils/logger.js";

const router = Router();

// Kill switch — 503 when beta is not live (mutating routes only)
const betaKillSwitch: RequestHandler = (_req, res, next) => {
  if (!BETA_LIVE) {
    res.status(503).json({
      success: false,
      error: "BETA_NOT_LIVE",
      message: "Beta system is not available yet",
    });
    return;
  }
  next();
};

const BETA_STATUS_CLOSED_PAYLOAD = {
  success: true,
  data: {
    spotsRemaining: 0,
    totalSpots: 0,
    isFull: false,
    userStatus: undefined,
  },
} as const;

const BETA_STATUS_CACHE_KEY = "beta:status:global";
const BETA_STATUS_CACHE_TTL_SECONDS = 30;
const BETA_STATUS_CDN_MAX_AGE_SECONDS = 60;

// GET /api/beta/status — public, ALWAYS responds 200 (no kill switch).
// Returns a benign payload when beta is closed so the frontend doesn't log
// console errors on every poll. The frontend gates on userStatus, not HTTP code.
//
// When BETA_LIVE=false: payload is global, skip auth and let the CDN cache it.
// When BETA_LIVE=true: cache the controller response in Redis (30s) so polling
// from N clients doesn't hammer Postgres on every tick.
router.get("/status", (req, res, next) => {
  if (!BETA_LIVE) {
    res.set("Cache-Control", `public, max-age=${BETA_STATUS_CDN_MAX_AGE_SECONDS}`);
    res.status(200).json(BETA_STATUS_CLOSED_PAYLOAD);
    return;
  }
  // Auth is only relevant when BETA_LIVE so we can attribute userStatus.
  optionalAuth(req, res, () => {
    void serveBetaStatusLive(req, res, next);
  });
});

async function serveBetaStatusLive(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): Promise<void> {
  try {
    const cached = await redis.get(BETA_STATUS_CACHE_KEY);
    if (cached) {
      res.status(200).json(JSON.parse(cached));
      return;
    }
  } catch (err) {
    logger.warn("[BETA_STATUS] Redis read failed, falling back to controller", err);
  }

  // Wrap res.json so we can persist the controller's payload into Redis once.
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      redis
        .setex(BETA_STATUS_CACHE_KEY, BETA_STATUS_CACHE_TTL_SECONDS, JSON.stringify(body))
        .catch((err: unknown) => {
          logger.warn("[BETA_STATUS] Redis cache write failed", err);
        });
    }
    return originalJson(body);
  }) as Response["json"];

  try {
    await StatusController.getStatus(req, res);
  } catch (err) {
    next(err);
  }
}

// All routes below this line require BETA_LIVE
router.use(betaKillSwitch);

// POST /api/beta/heartbeat — auth required + per-user rate limit
router.post(
  "/heartbeat",
  authenticateToken,
  betaHeartbeatRateLimit,
  HeartbeatController.recordHeartbeat,
);

// POST /api/beta/waitlist — public + IP rate limit anti-spam
router.post("/waitlist", betaWaitlistRateLimit, optionalAuth, WaitlistController.addToWaitlist);

// POST /api/beta/reactivate — auth required
router.post("/reactivate", authenticateToken, ReactivateController.reactivate);

// DELETE /api/beta/account — auth required + strict rate limit (1/hour)
router.delete(
  "/account",
  authenticateToken,
  blockImpersonation,
  accountDeleteRateLimit,
  DeleteAccountController.deleteAccount,
);

// GET /api/beta/account/export — auth required + strict rate limit (1/day)
router.get(
  "/account/export",
  authenticateToken,
  blockImpersonation,
  accountExportRateLimit,
  ExportAccountController.exportAccount,
);

export { router as betaRouter };
