/**
 * Admin Ops Controller
 * Handles alerts and impersonation endpoints.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { AlertsService } from "../services/admin/alertsService.js";
import { ImpersonationService } from "../services/admin/impersonationService.js";
import { AlertType, AlertFilters } from "../types/admin.types.js";
import { parsePagination, validateUserId, validateParam } from "../utils/adminHelpers.js";
import { z } from "zod";

const AlertTypeSchema = z.enum(["CHURN_SPIKE", "ERROR_RATE_HIGH", "REVENUE_DROP", "SIGNUPS_SPIKE"]);

export class AdminOpsController {
  /**
   * GET /api/admin/alerts
   * Query params: page, limit, type, acknowledged
   */
  static async getAlerts(req: Request, res: Response): Promise<void> {
    try {
      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string }, 50);

      const rawType = req.query.type as string | undefined;
      let alertType: AlertType | undefined;
      if (rawType) {
        const parsed = AlertTypeSchema.safeParse(rawType);
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
        page,
        limit,
        type: alertType,
        acknowledged:
          req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : undefined,
      };

      const result = await AlertsService.getAlerts(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_OPS] getAlerts error:", error);
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
      if (!validateParam(id, "id", res)) return;

      const result = await AlertsService.acknowledgeAlert(id, req.user!.id);

      if (!result.success) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, message: "Alerte acquittée" });
    } catch (error: unknown) {
      logger.error("[ADMIN_OPS] acknowledgeAlert error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'acquittement de l'alerte",
      });
    }
  }

  /**
   * POST /api/admin/impersonate/:userId
   * Generates a temporary impersonation token (15 min).
   */
  static async startImpersonation(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!validateUserId(userId, res)) return;

      const result = await ImpersonationService.startImpersonation(req.user!.id, userId);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_OPS] startImpersonation error:", error);
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
    } catch (error: unknown) {
      logger.error("[ADMIN_OPS] endImpersonation error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la fin de l'impersonation",
      });
    }
  }
}
