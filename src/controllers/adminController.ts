/**
 * Admin Controller
 * Handles HTTP requests for admin dashboard endpoints
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { adminExportQueue } from "../lib/queues.js";
import { markJobPending, getJobResult } from "../lib/jobResults.js";
import { AdminStatsService } from "../services/admin/adminStatsService.js";
import { HealthCheckService } from "../services/admin/healthCheckService.js";
import { getExportCSV } from "../workers/export.worker.js";
import { z } from "zod";
import {
  ModerationFilters,
  UserListFilters,
  AdminExportJobData,
  BetaUserListFilters,
  TrendPeriod,
  AlertType,
  AlertFilters,
} from "../types/admin.types.js";
import { BetaAdminService } from "../services/admin/betaAdminService.js";
import { TrendsMetricsService } from "../services/admin/trendsMetricsService.js";
import { AlertsService } from "../services/admin/alertsService.js";
import { ImpersonationService } from "../services/admin/impersonationService.js";
import { RetentionCohortService } from "../services/admin/retentionCohortService.js";
import { AdminNotesService } from "../services/admin/adminNotesService.js";
import { UserBulkService } from "../services/admin/userBulkService.js";
import { LtvService } from "../services/admin/ltvService.js";
import { AICostService } from "../services/admin/aiCostService.js";

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
      res.status(200).json({ success: true, data: { isAdmin: user?.isAdmin ?? false } });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] checkAdminStatus error:", error);
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
      logger.error("[ADMIN_CONTROLLER] getHealthStatus error:", error);
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
      logger.error("[ADMIN_CONTROLLER] getDashboard error:", error);
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
      logger.error("[ADMIN_CONTROLLER] getUserMetrics error:", error);
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
      logger.error("[ADMIN_CONTROLLER] getRevenueMetrics error:", error);
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
      logger.error("[ADMIN_CONTROLLER] getUsageMetrics error:", error);
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
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      if (startDate && isNaN(startDate.getTime())) {
        res.status(400).json({ success: false, error: "Format startDate invalide" });
        return;
      }
      if (endDate && isNaN(endDate.getTime())) {
        res.status(400).json({ success: false, error: "Format endDate invalide" });
        return;
      }

      // Validate pagination parameters (NaN protection)
      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const filters: ModerationFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit, 100),
        userId: req.query.userId as string | undefined,
        action: req.query.action as string | undefined,
        startDate,
        endDate,
      };

      const logs = await AdminStatsService.getModerationLogs(filters);
      res.status(200).json({ success: true, data: logs });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getModerationLogs error:", error);
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

      const result = await AdminStatsService.toggleUserStatus(userId, isActive, req.user!.id);
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
      logger.error("[ADMIN_CONTROLLER] toggleUserStatus error:", error);
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

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const filters: UserListFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit, 100),
        search: searchTerm,
        isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
      };

      const result = await AdminStatsService.getUserList(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserList error:", error);
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

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit, 100);

      const result = await AdminStatsService.getUserPages(userId, page, limit);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserPages error:", error);
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
        isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
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

      logger.log(`[ADMIN_CONTROLLER] Export job created: ${job.id}`);

      res.status(202).json({
        success: true,
        data: { jobId: job.id, message: "Export en cours de génération" },
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] initiateUserExport error:", error);
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

      type ExportJobPayload = { rowCount?: number };
      const ExportJobPayloadSchema = z.object({
        rowCount: z.number().optional(),
      }) satisfies z.ZodType<ExportJobPayload>;
      const jobResult = await getJobResult(jobId, userId, ExportJobPayloadSchema);

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
      logger.error("[ADMIN_CONTROLLER] getExportStatus error:", error);
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

      type ExportJobPayload = { rowCount?: number };
      const ExportJobPayloadSchema = z.object({
        rowCount: z.number().optional(),
      }) satisfies z.ZodType<ExportJobPayload>;
      const jobResult = await getJobResult(jobId, userId, ExportJobPayloadSchema);

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
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", Buffer.byteLength(csv, "utf8"));

      res.status(200).send(csv);
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] downloadExport error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors du téléchargement",
      });
    }
  }

  // ─── Trends Metrics ─────────────────────────────────────────────

  private static readonly TrendPeriodSchema = z.enum(["7d", "30d", "90d"]);

  /**
   * GET /api/admin/metrics/trends
   * Query param: period (7d | 30d | 90d, default 30d)
   */
  static async getTrendsMetrics(req: Request, res: Response): Promise<void> {
    try {
      const rawPeriod = (req.query.period as string) || "30d";
      const parsed = AdminController.TrendPeriodSchema.safeParse(rawPeriod);

      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "period invalide — valeurs acceptées : 7d, 30d, 90d",
        });
        return;
      }

      const period: TrendPeriod = parsed.data;
      const metrics = await TrendsMetricsService.getTrends(period);
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getTrendsMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des tendances",
      });
    }
  }

  // ─── AI Costs ──────────────────────────────────────────────────

  /**
   * GET /api/admin/metrics/ai-costs?period=30d
   */
  static async getAICosts(req: Request, res: Response): Promise<void> {
    try {
      const rawPeriod = (req.query.period as string) || "30d";
      const parsed = AdminController.TrendPeriodSchema.safeParse(rawPeriod);

      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "period invalide — valeurs acceptées : 7d, 30d, 90d",
        });
        return;
      }

      const period: TrendPeriod = parsed.data;
      const data = await AICostService.getAICosts(period);
      res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[ADMIN_CONTROLLER] getAICosts error:", { message });
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des coûts AI",
      });
    }
  }

  // ─── Retention Cohorts ──────────────────────────────────────────

  /**
   * GET /api/admin/metrics/cohorts
   * Query param: weeks (1-12, default 12)
   */
  static async getRetentionCohorts(req: Request, res: Response): Promise<void> {
    try {
      const rawWeeks = req.query.weeks ? parseInt(req.query.weeks as string, 10) : 12;
      const weeks = isNaN(rawWeeks) || rawWeeks < 1 ? 12 : Math.min(rawWeeks, 12);

      const data = await RetentionCohortService.getCohorts(weeks);
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getRetentionCohorts error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des cohortes de rétention",
      });
    }
  }

  // ─── LTV Metrics ──────────────────────────────────────────────────

  /**
   * GET /api/admin/metrics/ltv
   */
  static async getLtvMetrics(req: Request, res: Response): Promise<void> {
    try {
      const data = await LtvService.getLtvMetrics();
      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getLtvMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques LTV",
      });
    }
  }

  // ─── Alerts ────────────────────────────────────────────────────

  private static readonly AlertTypeSchema = z.enum([
    "CHURN_SPIKE",
    "ERROR_RATE_HIGH",
    "REVENUE_DROP",
    "SIGNUPS_SPIKE",
  ]);

  /**
   * GET /api/admin/alerts
   * Query params: page, limit, type, acknowledged
   */
  static async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const rawType = req.query.type as string | undefined;
      let alertType: AlertType | undefined;
      if (rawType) {
        const parsed = AdminController.AlertTypeSchema.safeParse(rawType);
        if (!parsed.success) {
          res.status(400).json({
            success: false,
            error:
              "type invalide — valeurs acceptées : CHURN_SPIKE, ERROR_RATE_HIGH, REVENUE_DROP, SIGNUPS_SPIKE",
          });
          return;
        }
        alertType = parsed.data;
      }

      const filters: AlertFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit, 100),
        type: alertType,
        acknowledged:
          req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : undefined,
      };

      const result = await AlertsService.getAlerts(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getAlerts error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des alertes",
      });
    }
  }

  /**
   * PATCH /api/admin/alerts/:id/acknowledge
   */
  static async acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id || id.length > 255) {
        res.status(400).json({ success: false, error: "id requis" });
        return;
      }

      const result = await AlertsService.acknowledgeAlert(id, req.user!.id);

      if (!result.success) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Alerte acquittée",
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] acknowledgeAlert error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'acquittement de l'alerte",
      });
    }
  }

  // ─── Impersonation ──────────────────────────────────────────────

  /**
   * POST /api/admin/impersonate/:userId
   * Generates a temporary impersonation token (15 min).
   */
  static async startImpersonation(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const result = await ImpersonationService.startImpersonation(req.user!.id, userId);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] startImpersonation error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors du démarrage de l'impersonation",
      });
    }
  }

  /**
   * POST /api/admin/impersonate/end
   * Ends the current impersonation session.
   */
  static async endImpersonation(req: Request, res: Response): Promise<void> {
    try {
      const result = await ImpersonationService.endImpersonation(req.user!.id);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, message: "Session d'impersonation terminée" });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] endImpersonation error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la fin de l'impersonation",
      });
    }
  }

  // ─── User Bulk Actions ────────────────────────────────────────────

  private static readonly UserBulkActionSchema = z.object({
    userIds: z.array(z.string().min(1).max(255)).min(1).max(100),
    action: z.enum(["activate", "deactivate"]),
  });

  /**
   * POST /api/admin/users/bulk
   * Body: { userIds: string[], action: "activate" | "deactivate" }
   */
  static async bulkUserAction(req: Request, res: Response): Promise<void> {
    try {
      const parsed = AdminController.UserBulkActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Données invalides: " + parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const { userIds, action } = parsed.data;

      // Prevent admin from bulk-acting on themselves
      if (userIds.includes(req.user!.id)) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas vous inclure dans une action en masse",
        });
        return;
      }

      const result = await UserBulkService.bulkAction(userIds, action, req.user!.id);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] bulkUserAction error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'action en masse",
      });
    }
  }

  // ─── Admin Notes ──────────────────────────────────────────────────

  private static readonly CreateNoteSchema = z.object({
    content: z
      .string()
      .min(1, "Le contenu est requis")
      .max(2000, "Le contenu ne peut pas dépasser 2000 caractères"),
  });

  /**
   * GET /api/admin/users/:userId/notes
   * Query params: page, limit
   */
  static async getUserNotes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit, 100);

      const result = await AdminNotesService.getNotes(userId, page, limit);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserNotes error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des notes",
      });
    }
  }

  /**
   * POST /api/admin/users/:userId/notes
   * Body: { content: string }
   */
  static async createUserNote(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const parsed = AdminController.CreateNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const result = await AdminNotesService.createNote(userId, req.user!.id, parsed.data.content);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(201).json({ success: true, data: result.note });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] createUserNote error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la création de la note",
      });
    }
  }

  /**
   * DELETE /api/admin/notes/:noteId
   */
  static async deleteNote(req: Request, res: Response): Promise<void> {
    try {
      const { noteId } = req.params;

      if (!noteId || noteId.length > 255) {
        res.status(400).json({ success: false, error: "noteId requis" });
        return;
      }

      const result = await AdminNotesService.deleteNote(noteId, req.user!.id);

      if (!result.success) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, message: "Note supprimée" });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] deleteNote error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression de la note",
      });
    }
  }

  // ─── Beta Management ────────────────────────────────────────────

  /**
   * GET /api/admin/beta/metrics
   * Query param: period (7 or 30, default 30)
   */
  static async getBetaMetrics(req: Request, res: Response): Promise<void> {
    try {
      const rawPeriod = req.query.period ? parseInt(req.query.period as string, 10) : 30;
      const period = rawPeriod === 7 ? 7 : 30;

      const metrics = await BetaAdminService.getBetaMetrics(period);
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getBetaMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques beta",
      });
    }
  }

  /**
   * GET /api/admin/beta/users
   * Query params: page, limit, search, betaStatus, sortBy, sortOrder
   */
  static async getBetaUsers(req: Request, res: Response): Promise<void> {
    try {
      const searchTerm = req.query.search as string | undefined;
      if (searchTerm && searchTerm.length > 100) {
        res.status(400).json({
          success: false,
          error: "Terme de recherche trop long (max 100 caractères)",
        });
        return;
      }

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const filters: BetaUserListFilters = {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage,
        limit: Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit, 100),
        search: searchTerm,
        betaStatus: req.query.betaStatus as string | undefined,
        sortBy: req.query.sortBy as string | undefined,
        sortOrder: req.query.sortOrder === "asc" ? "asc" : "desc",
      };

      const result = await BetaAdminService.getBetaUsers(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getBetaUsers error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des utilisateurs beta",
      });
    }
  }

  /**
   * POST /api/admin/beta/users/:userId/kick
   * Body: { reason?: string }
   */
  static async kickBetaUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      if (userId === req.user?.id) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas vous exclure vous-même",
        });
        return;
      }

      const reason =
        typeof req.body.reason === "string" ? req.body.reason.slice(0, 500) : undefined;

      const result = await BetaAdminService.kickUser(userId, req.user!.id, reason);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, data: { message: "Utilisateur exclu de la beta" } });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] kickBetaUser error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'exclusion de l'utilisateur",
      });
    }
  }

  /**
   * POST /api/admin/beta/users/:userId/promote
   */
  static async promoteBetaUser(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const result = await BetaAdminService.promoteUser(userId, req.user!.id);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res
        .status(200)
        .json({ success: true, data: { message: "Utilisateur promu en beta active" } });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] promoteBetaUser error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la promotion de l'utilisateur",
      });
    }
  }

  /**
   * POST /api/admin/beta/bulk
   * Body: { userIds: string[], action: "kick" | "promote", reason?: string }
   */
  static async bulkBetaAction(req: Request, res: Response): Promise<void> {
    try {
      const BulkActionSchema = z.object({
        userIds: z.array(z.string().min(1).max(255)).min(1).max(50),
        action: z.enum(["kick", "promote"]),
        reason: z.string().max(500).optional(),
      });

      const parsed = BulkActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Données invalides: " + parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const { userIds, action, reason } = parsed.data;

      if (userIds.includes(req.user!.id)) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas vous inclure dans une action en masse",
        });
        return;
      }

      const result = await BetaAdminService.bulkAction(userIds, action, req.user!.id, reason);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] bulkBetaAction error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'action groupée",
      });
    }
  }

  // ─── User Detail Panel ───────────────────────────────────────────

  /**
   * GET /api/admin/users/:userId/conversations
   * List AI conversations for a specific user with pagination
   */
  static async getUserConversations(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit, 100);
      const skip = (page - 1) * limit;

      const [conversations, total] = await Promise.all([
        prisma.aIConversation.findMany({
          where: { userId },
          select: {
            id: true,
            title: true,
            status: true,
            messageCount: true,
            lastMessageAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.aIConversation.count({ where: { userId } }),
      ]);

      logger.log("[ADMIN_CONTROLLER] getUserConversations", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.conversations.list",
        resultCount: conversations.length,
      });

      res.status(200).json({
        success: true,
        data: {
          conversations,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserConversations error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des conversations",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/conversations/:conversationId
   * Get full conversation detail with messages
   */
  static async getUserConversationDetail(req: Request, res: Response): Promise<void> {
    try {
      const { userId, conversationId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      if (!conversationId || conversationId.length > 255) {
        res.status(400).json({ success: false, error: "conversationId requis" });
        return;
      }

      const conversation = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId },
        select: {
          id: true,
          title: true,
          status: true,
          messageCount: true,
          messages: {
            select: {
              id: true,
              role: true,
              content: true,
              mode: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
            take: 500,
          },
        },
      });

      if (!conversation) {
        res.status(404).json({
          success: false,
          error: "Conversation non trouvée pour cet utilisateur",
        });
        return;
      }

      logger.log("[ADMIN_CONTROLLER] getUserConversationDetail", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.conversation.detail",
        resourceId: conversationId,
      });

      res.status(200).json({
        success: true,
        data: { conversation },
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserConversationDetail error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération de la conversation",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/quizzes
   * List quizzes for a specific user with pagination and results
   */
  static async getUserQuizzes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      const parsedPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const parsedLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const page = isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
      const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit, 100);
      const skip = (page - 1) * limit;

      const [quizzes, total] = await Promise.all([
        prisma.quiz.findMany({
          where: { userId },
          select: {
            id: true,
            title: true,
            isCompleted: true,
            schoolLevel: true,
            timeSpent: true,
            completedAt: true,
            createdAt: true,
            result: {
              select: {
                percentage: true,
                adaptedGrade: true,
                gradeScale: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.quiz.count({ where: { userId } }),
      ]);

      logger.log("[ADMIN_CONTROLLER] getUserQuizzes", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.quizzes.list",
        resultCount: quizzes.length,
      });

      res.status(200).json({
        success: true,
        data: {
          quizzes: quizzes.map((q) => ({
            id: q.id,
            title: q.title,
            isCompleted: q.isCompleted,
            schoolLevel: q.schoolLevel,
            timeSpent: q.timeSpent,
            completedAt: q.completedAt,
            createdAt: q.createdAt,
            result: q.result
              ? {
                  percentage: q.result.percentage,
                  adaptedGrade: q.result.adaptedGrade,
                  gradeScale: q.result.gradeScale,
                }
              : null,
          })),
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserQuizzes error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des quizzes",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/pages/:pageId/content
   * Get page content read-only for admin viewing
   */
  static async getUserPageContent(req: Request, res: Response): Promise<void> {
    try {
      const { userId, pageId } = req.params;

      if (!userId || userId.length > 255) {
        res.status(400).json({ success: false, error: "userId requis" });
        return;
      }

      if (!pageId || pageId.length > 255) {
        res.status(400).json({ success: false, error: "pageId requis" });
        return;
      }

      const page = await prisma.page.findFirst({
        where: { id: pageId, createdBy: userId },
        select: {
          id: true,
          title: true,
          icon: true,
          iconColor: true,
          blockNoteContent: true,
          createdAt: true,
          updatedAt: true,
          workspace: {
            select: { name: true },
          },
        },
      });

      if (!page) {
        res.status(404).json({
          success: false,
          error: "Page non trouvée pour cet utilisateur",
        });
        return;
      }

      logger.log("[ADMIN_CONTROLLER] getUserPageContent", {
        adminId: req.user!.id,
        targetUserId: userId,
        action: "admin.user.page.content",
        resourceId: pageId,
      });

      res.status(200).json({
        success: true,
        data: {
          page: {
            id: page.id,
            title: page.title,
            icon: page.icon,
            iconColor: page.iconColor,
            content: page.blockNoteContent,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
            workspaceName: page.workspace.name,
          },
        },
      });
    } catch (error) {
      logger.error("[ADMIN_CONTROLLER] getUserPageContent error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du contenu de la page",
      });
    }
  }
}
