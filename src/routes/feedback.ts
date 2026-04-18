import { Router, Request, Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticateToken } from "../middlewares/auth.js";
import { EmailService } from "../services/EmailService.js";
import { logger } from "../utils/logger.js";
import { getRateLimitStoreWithFallback } from "../config/rateLimitStore.js";

const feedbackRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as Request & { user?: { id: string } }).user?.id ?? "unknown",
  message: { error: "Trop de feedbacks envoyés. Réessayez dans 1 heure." },
  store: getRateLimitStoreWithFallback("feedback"),
});

// Second-tier anti-spam on the email address itself — catches multi-account abuse.
const feedbackEmailRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    (req as Request & { user?: { email: string } }).user?.email ?? "unknown",
  message: { error: "Limite quotidienne atteinte. Réessayez demain." },
  store: getRateLimitStoreWithFallback("feedback-email"),
});

const feedbackSchema = z.object({
  type: z.enum(["bug", "suggestion", "other"]),
  message: z.string().min(1).max(1000),
  whatsappName: z.string().max(100).optional(),
  currentUrl: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  errorLogs: z
    .array(
      z.object({
        timestamp: z.string(),
        type: z.enum(["ERROR", "FETCH_ERROR", "UNHANDLED", "PROMISE_REJECTION"]),
        message: z.string().max(600),
        url: z.string().max(500).optional(),
        stack: z.string().max(400).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const feedbackRouter = Router();

feedbackRouter.post(
  "/",
  authenticateToken,
  feedbackRateLimit,
  feedbackEmailRateLimit,
  async (req: Request, res: Response) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors });
      return;
    }

    const user = (req as Request & { user: { id: string; email: string } }).user;
    const { type, message, whatsappName, currentUrl, userAgent, errorLogs } = parsed.data;

    try {
      await EmailService.sendFeedbackReport({
        userId: user.id,
        userEmail: user.email,
        type,
        message,
        whatsappName,
        currentUrl,
        userAgent,
        errorLogs,
      });

      logger.log(`[FEEDBACK] ${type} received from user ${user.id}`);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error("[FEEDBACK] Failed to send feedback email:", error);
      res.status(500).json({ error: "Erreur lors de l'envoi du feedback" });
    }
  },
);
