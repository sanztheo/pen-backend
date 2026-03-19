/**
 * Admin Routes
 * All routes require authentication + admin privileges + rate limiting
 */

import { Router, Request, Response, NextFunction } from "express";
import { AdminDashboardController } from "../controllers/adminDashboardController.js";
import { AdminUserController } from "../controllers/adminUserController.js";
import { AdminUserDetailController } from "../controllers/adminUserDetailController.js";
import { AdminExportController } from "../controllers/adminExportController.js";
import { AdminOpsController } from "../controllers/adminOpsController.js";
import { AdminBetaController } from "../controllers/adminBetaController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { adminRateLimit } from "../middlewares/rateLimiting.js";

const router = Router();

const adminCacheControl = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("Cache-Control", "private, no-cache, no-store");
  next();
};

// Check admin status (auth only, no requireAdmin - used by frontend to check access)
router.get("/check", authenticateToken, AdminDashboardController.checkAdminStatus);

// Apply auth + admin + rate limiting + cache control middleware to all other routes
router.use(authenticateToken, requireAdmin, adminRateLimit, adminCacheControl);

// Health check (comprehensive service status)
router.get("/health", AdminDashboardController.getHealthStatus);

// Dashboard (all metrics in one call)
router.get("/dashboard", AdminDashboardController.getDashboard);

// Individual metrics endpoints
router.get("/metrics/users", AdminDashboardController.getUserMetrics);
router.get("/metrics/revenue", AdminDashboardController.getRevenueMetrics);
router.get("/metrics/usage", AdminDashboardController.getUsageMetrics);
router.get("/metrics/trends", AdminDashboardController.getTrendsMetrics);
router.get("/metrics/cohorts", AdminDashboardController.getRetentionCohorts);
router.get("/metrics/ltv", AdminDashboardController.getLtvMetrics);
router.get("/metrics/ai-costs", AdminDashboardController.getAICosts);

// Moderation
router.get("/moderation/logs", AdminUserController.getModerationLogs);

// User management
router.get("/users", AdminUserController.getUserList);
router.get("/users/:userId/pages", AdminUserController.getUserPages);
router.get("/users/:userId/pages/:pageId/content", AdminUserDetailController.getUserPageContent);
router.get("/users/:userId/conversations", AdminUserDetailController.getUserConversations);
router.get(
  "/users/:userId/conversations/:conversationId",
  AdminUserDetailController.getUserConversationDetail,
);
router.get("/users/:userId/quizzes", AdminUserDetailController.getUserQuizzes);
router.get("/users/:userId/quizzes/:quizId", AdminUserDetailController.getUserQuizDetail);
router.get("/users/:userId/ai-usage", AdminUserDetailController.getUserAIUsage);
router.get("/users/:userId/notes", AdminUserController.getUserNotes);
router.post("/users/:userId/notes", AdminUserController.createUserNote);
router.post("/users/:userId/toggle-status", AdminUserController.toggleUserStatus);

// Admin notes (delete uses noteId, not userId)
router.delete("/notes/:noteId", AdminUserController.deleteNote);

// User bulk actions
router.post("/users/bulk", AdminUserController.bulkUserAction);

// User export (CSV)
router.post("/users/export", AdminExportController.initiateUserExport);
router.get("/users/export/:jobId/status", AdminExportController.getExportStatus);
router.get("/users/export/:jobId/download", AdminExportController.downloadExport);

// Alerts
router.get("/alerts", AdminOpsController.getAlerts);
router.patch("/alerts/:id/acknowledge", AdminOpsController.acknowledgeAlert);

// Impersonation (end must be before :userId to avoid matching "end" as userId)
router.post("/impersonate/end", AdminOpsController.endImpersonation);
router.post("/impersonate/:userId", AdminOpsController.startImpersonation);

// Beta management
router.get("/beta/metrics", AdminBetaController.getBetaMetrics);
router.get("/beta/users", AdminBetaController.getBetaUsers);
router.post("/beta/users/:userId/kick", AdminBetaController.kickBetaUser);
router.post("/beta/users/:userId/promote", AdminBetaController.promoteBetaUser);
router.post("/beta/bulk", AdminBetaController.bulkBetaAction);

export { router as adminRouter };
