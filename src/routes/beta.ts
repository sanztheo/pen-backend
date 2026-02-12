import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticateToken, optionalAuth } from "../middlewares/auth.js";
import {
  betaHeartbeatRateLimit,
  betaWaitlistRateLimit,
} from "../middlewares/rateLimiting.js";
import {
  StatusController,
  HeartbeatController,
  WaitlistController,
  ReactivateController,
} from "../controllers/beta/index.js";
import { BETA_LIVE } from "../config/beta.js";

const router = Router();

// Kill switch — 503 when beta is not live
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

router.use(betaKillSwitch);

// GET /api/beta/status — public (optionalAuth for userStatus)
router.get("/status", optionalAuth, StatusController.getStatus);

// POST /api/beta/heartbeat — auth required + per-user rate limit
router.post(
  "/heartbeat",
  authenticateToken,
  betaHeartbeatRateLimit,
  HeartbeatController.recordHeartbeat,
);

// POST /api/beta/waitlist — public + IP rate limit anti-spam
router.post(
  "/waitlist",
  betaWaitlistRateLimit,
  optionalAuth,
  WaitlistController.addToWaitlist,
);

// POST /api/beta/reactivate — auth required
router.post("/reactivate", authenticateToken, ReactivateController.reactivate);

export { router as betaRouter };
