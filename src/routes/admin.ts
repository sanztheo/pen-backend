/**
 * Admin Routes
 * All routes require authentication + admin privileges + rate limiting
 */

import { Router, Request, Response, NextFunction } from "express";
import { AdminController } from "../controllers/adminController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { adminRateLimit } from "../middlewares/rateLimiting.js";

const router = Router();

const adminCacheControl = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "private, no-cache, no-store");
  next();
};

// Check admin status (auth only, no requireAdmin - used by frontend to check access)
router.get("/check", authenticateToken, AdminController.checkAdminStatus);

// Apply auth + admin + rate limiting + cache control middleware to all other routes
router.use(authenticateToken, requireAdmin, adminRateLimit, adminCacheControl);

// Health check (comprehensive service status)
router.get("/health", AdminController.getHealthStatus);

// Dashboard (all metrics in one call)
router.get("/dashboard", AdminController.getDashboard);

// Individual metrics endpoints
router.get("/metrics/users", AdminController.getUserMetrics);
router.get("/metrics/revenue", AdminController.getRevenueMetrics);
router.get("/metrics/usage", AdminController.getUsageMetrics);
router.get("/metrics/trends", AdminController.getTrendsMetrics);
router.get("/metrics/cohorts", AdminController.getRetentionCohorts);
router.get("/metrics/ltv", AdminController.getLtvMetrics);

// Moderation
router.get("/moderation/logs", AdminController.getModerationLogs);

// User management
router.get("/users", AdminController.getUserList);
router.get("/users/:userId/pages", AdminController.getUserPages);
router.get("/users/:userId/notes", AdminController.getUserNotes);
router.post("/users/:userId/notes", AdminController.createUserNote);
router.post("/users/:userId/toggle-status", AdminController.toggleUserStatus);

// Admin notes (delete uses noteId, not userId)
router.delete("/notes/:noteId", AdminController.deleteNote);

// User bulk actions
router.post("/users/bulk", AdminController.bulkUserAction);

// User export (CSV)
router.post("/users/export", AdminController.initiateUserExport);
router.get("/users/export/:jobId/status", AdminController.getExportStatus);
router.get("/users/export/:jobId/download", AdminController.downloadExport);

// Alerts
router.get("/alerts", AdminController.getAlerts);
router.patch("/alerts/:id/acknowledge", AdminController.acknowledgeAlert);

// Impersonation (end must be before :userId to avoid matching "end" as userId)
router.post("/impersonate/end", AdminController.endImpersonation);
router.post("/impersonate/:userId", AdminController.startImpersonation);

// AI Costs
router.get("/metrics/ai-costs", AdminController.getAICosts);

// Beta management
router.get("/beta/metrics", AdminController.getBetaMetrics);
router.get("/beta/users", AdminController.getBetaUsers);
router.post("/beta/users/:userId/kick", AdminController.kickBetaUser);
router.post("/beta/users/:userId/promote", AdminController.promoteBetaUser);
router.post("/beta/bulk", AdminController.bulkBetaAction);

export { router as adminRouter };
