import { Router } from "express";
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

const router = Router();

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
