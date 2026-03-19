/**
 * Admin Export Controller
 * Handles user data export (CSV): initiate, status check, download.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { adminExportQueue } from "../lib/queues.js";
import { markJobPending, getJobResult } from "../lib/jobResults.js";
import { getExportCSV } from "../workers/export.worker.js";
import { UserListFilters, AdminExportJobData } from "../types/admin.types.js";
import { validateParam } from "../utils/adminHelpers.js";
import { z } from "zod";

const MAX_SEARCH_LENGTH = 100;

const ExportJobPayloadSchema = z.object({
  rowCount: z.number().optional(),
});

export class AdminExportController {
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
      if (searchTerm && searchTerm.length > MAX_SEARCH_LENGTH) {
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

      logger.log(`[ADMIN_EXPORT] Export job created: ${job.id}`);

      res.status(202).json({
        success: true,
        data: { jobId: job.id, message: "Export en cours de génération" },
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_EXPORT] initiateUserExport error:", error);
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

      if (!validateParam(jobId, "jobId", res)) return;

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
    } catch (error: unknown) {
      logger.error("[ADMIN_EXPORT] getExportStatus error:", error);
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

      if (!validateParam(jobId, "jobId", res)) return;

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
    } catch (error: unknown) {
      logger.error("[ADMIN_EXPORT] downloadExport error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors du téléchargement",
      });
    }
  }
}
