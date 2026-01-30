/**
 * Admin Controller
 * Handles HTTP requests for admin dashboard endpoints
 */

import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { adminExportQueue } from "../lib/queues.js";
import { markJobPending, getJobResult } from "../lib/jobResults.js";
import { AdminStatsService } from "../services/admin/adminStatsService.js";
import { HealthCheckService } from "../services/admin/healthCheckService.js";
import { getExportCSV } from "../workers/export.worker.js";
import {
  ModerationFilters,
  UserListFilters,
  AdminExportJobData,
} from "../types/admin.types.js";

export class AdminController {
  /**
   * GET /api/admin/check
   * Check if current user is admin (used by frontend before loading dashboard)
   */
  static async checkAdminStatus(req: Request, res: Response): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { isAdmin: true },
      });
      res
        .status(200)
        .json({ success: true, data: { isAdmin: user?.isAdmin ?? false } });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] checkAdminStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la vérification admin",
      });
    }
  }

  /**
   * GET /api/admin/health
   * Get comprehensive health status of all services
   */
  static async getHealthStatus(req: Request, res: Response): Promise<void> {
    try {
      const healthData = await HealthCheckService.getHealthStatus();
      res.status(200).json({ success: true, data: healthData });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getHealthStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la vérification de santé",
      });
    }
  }

  /**
   * GET /api/admin/dashboard
   * Get all dashboard metrics in one call
   */
  static async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getDashboardMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getDashboard error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du dashboard",
      });
    }
  }

  /**
   * GET /api/admin/metrics/users
   */
  static async getUserMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getUserMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getUserMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques utilisateurs",
      });
    }
  }

  /**
   * GET /api/admin/metrics/revenue
   */
  static async getRevenueMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getRevenueMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getRevenueMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques de revenus",
      });
    }
  }

  /**
   * GET /api/admin/metrics/usage
   */
  static async getUsageMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getUsageMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getUsageMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques d'utilisation",
      });
    }
  }

  /**
   * GET /api/admin/moderation/logs
   * Query params: page, limit, userId, action, startDate, endDate
   */
  static async getModerationLogs(req: Request, res: Response): Promise<void> {
    try {
      // Validate dates if provided
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;

      if (startDate && isNaN(startDate.getTime())) {
        res
          .status(400)
          .json({ success: false, error: "Format startDate invalide" });
        return;
      }
      if (endDate && isNaN(endDate.getTime())) {
        res
          .status(400)
          .json({ success: false, error: "Format endDate invalide" });
        return;
      }

      // Validate pagination parameters (NaN protection)
      const parsedPage = req.query.page
        ? parseInt(req.query.page as string, 10)
        : 1;
      const parsedLimit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;

      const filters: ModerationFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit,
        userId: req.query.userId as string | undefined,
        action: req.query.action as string | undefined,
        startDate,
        endDate,
      };

      const logs = await AdminStatsService.getModerationLogs(filters);
      res.status(200).json({ success: true, data: logs });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getModerationLogs error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des logs de modération",
      });
    }
  }

  /**
   * POST /api/admin/users/:userId/toggle-status
   * Body: { isActive: boolean }
   */
  static async toggleUserStatus(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { isActive } = req.body;

      // Basic validation - let DB handle unknown IDs (returns 404 naturally)
      if (!userId || userId.length > 255) {
        res.status(400).json({
          success: false,
          error: "userId requis",
        });
        return;
      }

      if (typeof isActive !== "boolean") {
        res.status(400).json({
          success: false,
          error: "isActive doit être un booléen",
        });
        return;
      }

      // Prevent admin from deactivating themselves
      if (userId === req.user?.id) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas modifier votre propre compte",
        });
        return;
      }

      const result = await AdminStatsService.toggleUserStatus(
        userId,
        isActive,
        req.user!.id,
      );
      if (!result.success) {
        res.status(404).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Utilisateur ${isActive ? "activé" : "désactivé"} avec succès`,
      });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] toggleUserStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la modification du statut utilisateur",
      });
    }
  }

  /**
   * GET /api/admin/users
   * Get paginated list of users with stats
   */
  static async getUserList(req: Request, res: Response): Promise<void> {
    try {
      // Security: Limit search term length to prevent DoS
      const searchTerm = req.query.search as string | undefined;
      if (searchTerm && searchTerm.length > 100) {
        res.status(400).json({
          success: false,
          error: "Terme de recherche trop long (max 100 caractères)",
        });
        return;
      }

      const parsedPage = req.query.page
        ? parseInt(req.query.page as string, 10)
        : 1;
      const parsedLimit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;

      const filters: UserListFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit,
        search: searchTerm,
        isActive:
          req.query.isActive !== undefined
            ? req.query.isActive === "true"
            : undefined,
      };

      const result = await AdminStatsService.getUserList(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getUserList error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des utilisateurs",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/pages
   * Get paginated list of pages for a specific user
   */
  static async getUserPages(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      // Basic validation - let DB handle unknown IDs
      if (!userId || userId.length > 255) {
        res.status(400).json({
          success: false,
          error: "userId requis",
        });
        return;
      }

      const parsedPage = req.query.page
        ? parseInt(req.query.page as string, 10)
        : 1;
      const parsedLimit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;

      const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const limit = isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit;

      const result = await AdminStatsService.getUserPages(userId, page, limit);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getUserPages error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des pages utilisateur",
      });
    }
  }

  /**
   * POST /api/admin/users/export
   * Initiate user export job (CSV)
   */
  static async initiateUserExport(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;

      const admin = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!admin) {
        res.status(404).json({ success: false, error: "Admin non trouvé" });
        return;
      }

      const searchTerm = req.query.search as string | undefined;
      if (searchTerm && searchTerm.length > 100) {
        res.status(400).json({
          success: false,
          error: "Terme de recherche trop long (max 100 caractères)",
        });
        return;
      }

      const filters: UserListFilters = {
        search: searchTerm,
        isActive:
          req.query.isActive !== undefined
            ? req.query.isActive === "true"
            : undefined,
      };

      const jobData: AdminExportJobData = {
        type: "admin-user-export",
        userId,
        adminEmail: admin.email,
        filters,
      };

      const job = await adminExportQueue.add("admin-user-export", jobData);

      if (!job.id) {
        res.status(500).json({ success: false, error: "Échec création job" });
        return;
      }

      await markJobPending(job.id, userId);

      await prisma.activityLog.create({
        data: {
          userId,
          action: "ADMIN_EXPORT_USERS_INITIATED",
          entityType: "export",
          entityId: job.id,
          details: JSON.parse(JSON.stringify({ filters })),
        },
      });

      console.log(`[ADMIN_CONTROLLER] Export job created: ${job.id}`);

      res.status(202).json({
        success: true,
        data: { jobId: job.id, message: "Export en cours de génération" },
      });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] initiateUserExport error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors du lancement de l'export",
      });
    }
  }

  /**
   * GET /api/admin/users/export/:jobId/status
   */
  static async getExportStatus(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const userId = req.user!.id;

      if (!jobId) {
        res.status(400).json({ success: false, error: "jobId requis" });
        return;
      }

      const jobResult = await getJobResult(jobId, userId);

      if (!jobResult) {
        res.status(404).json({
          success: false,
          error: "Job non trouvé ou accès refusé",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          jobId,
          status: jobResult.status,
          rowCount: jobResult.result?.rowCount,
          error: jobResult.error,
          createdAt: jobResult.createdAt,
          completedAt: jobResult.completedAt,
        },
      });
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] getExportStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la vérification du statut",
      });
    }
  }

  /**
   * GET /api/admin/users/export/:jobId/download
   */
  static async downloadExport(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      const userId = req.user!.id;

      if (!jobId) {
        res.status(400).json({ success: false, error: "jobId requis" });
        return;
      }

      const jobResult = await getJobResult(jobId, userId);

      if (!jobResult) {
        res.status(404).json({
          success: false,
          error: "Job non trouvé ou accès refusé",
        });
        return;
      }

      if (jobResult.status !== "completed") {
        res.status(400).json({
          success: false,
          error: `Export non prêt (status: ${jobResult.status})`,
        });
        return;
      }

      const csv = await getExportCSV(userId, jobId);

      if (!csv) {
        res.status(410).json({
          success: false,
          error: "Export expiré (TTL 5 minutes)",
        });
        return;
      }

      const filename = `pennote-users-export-${new Date().toISOString().split("T")[0]}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Length", Buffer.byteLength(csv, "utf8"));

      res.status(200).send(csv);
    } catch (error) {
      console.error("[ADMIN_CONTROLLER] downloadExport error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors du téléchargement",
      });
    }
  }
}
