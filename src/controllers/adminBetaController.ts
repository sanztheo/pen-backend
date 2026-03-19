/**
 * Admin Beta Controller
 * Handles beta program management: metrics, user listing, kick, promote, bulk.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { BetaAdminService } from "../services/admin/betaAdminService.js";
import { BetaUserListFilters } from "../types/admin.types.js";
import { parsePagination, validateUserId } from "../utils/adminHelpers.js";
import { z } from "zod";

const MAX_SEARCH_LENGTH = 100;
const MAX_REASON_LENGTH = 500;

const BulkBetaActionSchema = z.object({
  userIds: z.array(z.string().min(1).max(255)).min(1).max(50),
  action: z.enum(["kick", "promote"]),
  reason: z.string().max(MAX_REASON_LENGTH).optional(),
});

export class AdminBetaController {
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
    } catch (error: unknown) {
      logger.error("[ADMIN_BETA] getBetaMetrics error:", error);
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
      if (searchTerm && searchTerm.length > MAX_SEARCH_LENGTH) {
        res.status(400).json({
          success: false,
          error: "Terme de recherche trop long (max 100 caractères)",
        });
        return;
      }

      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string });

      const filters: BetaUserListFilters = {
        page,
        limit,
        search: searchTerm,
        betaStatus: req.query.betaStatus as string | undefined,
        sortBy: req.query.sortBy as string | undefined,
        sortOrder: req.query.sortOrder === "asc" ? "asc" : "desc",
      };

      const result = await BetaAdminService.getBetaUsers(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_BETA] getBetaUsers error:", error);
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
      if (!validateUserId(userId, res)) return;

      if (userId === req.user?.id) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas vous exclure vous-même",
        });
        return;
      }

      const reason =
        typeof req.body.reason === "string"
          ? req.body.reason.slice(0, MAX_REASON_LENGTH)
          : undefined;

      const result = await BetaAdminService.kickUser(userId, req.user!.id, reason);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({ success: true, data: { message: "Utilisateur exclu de la beta" } });
    } catch (error: unknown) {
      logger.error("[ADMIN_BETA] kickBetaUser error:", error);
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
      if (!validateUserId(userId, res)) return;

      const result = await BetaAdminService.promoteUser(userId, req.user!.id);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      res
        .status(200)
        .json({ success: true, data: { message: "Utilisateur promu en beta active" } });
    } catch (error: unknown) {
      logger.error("[ADMIN_BETA] promoteBetaUser error:", error);
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
      const parsed = BulkBetaActionSchema.safeParse(req.body);
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
    } catch (error: unknown) {
      logger.error("[ADMIN_BETA] bulkBetaAction error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'action groupée",
      });
    }
  }
}
