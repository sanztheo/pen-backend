/**
 * Admin Routes
 * All routes require authentication + admin privileges + rate limiting
 */

import { Router } from "express";
import { AdminController } from "../controllers/adminController.js";
import { authenticateToken } from "../middlewares/auth.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { adminRateLimit } from "../middlewares/rateLimiting.js";

const router = Router();

// Check admin status (auth only, no requireAdmin - used by frontend to check access)
router.get("/check", authenticateToken, AdminController.checkAdminStatus);

// Apply auth + admin + rate limiting middleware to all other routes
router.use(authenticateToken, requireAdmin, adminRateLimit);

// Health check (comprehensive service status)
router.get("/health", AdminController.getHealthStatus);

// Dashboard (all metrics in one call)
router.get("/dashboard", AdminController.getDashboard);

// Individual metrics endpoints
router.get("/metrics/users", AdminController.getUserMetrics);
router.get("/metrics/revenue", AdminController.getRevenueMetrics);
router.get("/metrics/usage", AdminController.getUsageMetrics);

// Moderation
router.get("/moderation/logs", AdminController.getModerationLogs);

// User management
router.get("/users", AdminController.getUserList);
router.get("/users/:userId/pages", AdminController.getUserPages);
router.post("/users/:userId/toggle-status", AdminController.toggleUserStatus);

export default router;
