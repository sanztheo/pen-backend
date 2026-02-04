import { Router, Request, Response } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { logger } from "../utils/logger.js";

const router = Router();

// Cookie configuration
const COOKIE_NAME = "pen_session";
// In production, use SESSION_COOKIE_DOMAIN env var (e.g., ".pennote.fr")
// In dev, undefined means cookie is set on current domain only
const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;

interface SessionData {
  id: string;
  firstName: string;
  avatar: string;
}

/**
 * POST /api/auth/sync-session
 * Sets a session cookie on .pennote.fr domain for cross-domain avatar display
 * Called after successful Clerk login
 */
router.post(
  "/sync-session",
  authenticateToken,
  (req: Request, res: Response): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const sessionData: SessionData = {
      id: user.id,
      firstName: user.user_metadata?.firstName || "",
      avatar: user.user_metadata?.avatar || "",
    };

    logger.log(
      `[SYNC-SESSION] Setting session cookie for user ${user.id} (${user.user_metadata?.firstName || "no name"})`,
    );

    res.cookie(COOKIE_NAME, JSON.stringify(sessionData), {
      domain: COOKIE_DOMAIN,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: false, // Must be readable by JS on website
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.json({ success: true });
  },
);

/**
 * DELETE /api/auth/sync-session
 * Clears the session cookie on logout
 */
router.delete("/sync-session", (_req: Request, res: Response): void => {
  logger.log("[SYNC-SESSION] Clearing session cookie");

  res.cookie(COOKIE_NAME, "", {
    domain: COOKIE_DOMAIN,
    path: "/",
    maxAge: 0, // Expire immediately
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  res.json({ success: true });
});

export { router as syncSessionRouter };
