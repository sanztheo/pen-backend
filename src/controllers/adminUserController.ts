/**
 * Admin User Controller
 * Handles user listing, moderation, status toggling, notes, and bulk actions.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { AdminStatsService } from "../services/admin/adminStatsService.js";
import { AdminNotesService } from "../services/admin/adminNotesService.js";
import { UserBulkService } from "../services/admin/userBulkService.js";
import { ModerationFilters, UserListFilters } from "../types/admin.types.js";
import { parsePagination, validateUserId } from "../utils/adminHelpers.js";
import { z } from "zod";

const MAX_SEARCH_LENGTH = 100;
const MAX_FILTER_LENGTH = 255;

const ModerationLogsQuerySchema = z.object({
  userId: z.string().max(MAX_FILTER_LENGTH).optional(),
  action: z.string().max(MAX_FILTER_LENGTH).optional(),
});

const UserBulkActionSchema = z.object({
  userIds: z.array(z.string().min(1).max(255)).min(1).max(100),
  action: z.enum(["activate", "deactivate"]),
});

const ToggleUserStatusSchema = z.object({
  isActive: z.boolean({
    required_error: "isActive est requis",
    invalid_type_error: "isActive doit être un booléen",
  }),
});

const CreateNoteSchema = z.object({
  content: z
    .string()
    .min(1, "Le contenu est requis")
    .max(2000, "Le contenu ne peut pas dépasser 2000 caractères"),
});

export class AdminUserController {
  /**
   * GET /api/admin/moderation/logs
   * Query params: page, limit, userId, action, startDate, endDate
   */
  static async getModerationLogs(req: Request, res: Response): Promise<void> {
    try {
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

      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string }, 50);

      const queryParsed = ModerationLogsQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        res.status(400).json({
          success: false,
          error:
            "Paramètres invalides: " + queryParsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const filters: ModerationFilters = {
        page,
        limit,
        userId: queryParsed.data.userId,
        action: queryParsed.data.action,
        startDate,
        endDate,
      };

      const logs = await AdminStatsService.getModerationLogs(filters);
      res.status(200).json({ success: true, data: logs });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] getModerationLogs error:", error);
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
      if (!validateUserId(userId, res)) return;

      const parsed = ToggleUserStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const { isActive } = parsed.data;

      if (userId === req.user?.id) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas modifier votre propre compte",
        });
        return;
      }

      const result = await AdminStatsService.toggleUserStatus(userId, isActive, req.user!.id);
      if (!result.success) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Utilisateur ${isActive ? "activé" : "désactivé"} avec succès`,
      });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] toggleUserStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la modification du statut utilisateur",
      });
    }
  }

  /**
   * GET /api/admin/users
   */
  static async getUserList(req: Request, res: Response): Promise<void> {
    try {
      const searchTerm = req.query.search as string | undefined;
      if (searchTerm && searchTerm.length > MAX_SEARCH_LENGTH) {
        res.status(400).json({
          success: false,
          error: "Terme de recherche trop long (max 100 caractères)",
        });
        return;
      }

      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string }, 50);

      const filters: UserListFilters = {
        page,
        limit,
        search: searchTerm,
        isActive: req.query.isActive !== undefined ? req.query.isActive === "true" : undefined,
      };

      const result = await AdminStatsService.getUserList(filters);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] getUserList error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des utilisateurs",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/pages
   */
  static async getUserPages(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!validateUserId(userId, res)) return;

      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string }, 50);

      const result = await AdminStatsService.getUserPages(userId, page, limit);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] getUserPages error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des pages utilisateur",
      });
    }
  }

  /**
   * POST /api/admin/users/bulk
   * Body: { userIds: string[], action: "activate" | "deactivate" }
   */
  static async bulkUserAction(req: Request, res: Response): Promise<void> {
    try {
      const parsed = UserBulkActionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Données invalides: " + parsed.error.issues.map((i) => i.message).join(", "),
        });
        return;
      }

      const { userIds, action } = parsed.data;

      if (userIds.includes(req.user!.id)) {
        res.status(400).json({
          success: false,
          error: "Vous ne pouvez pas vous inclure dans une action en masse",
        });
        return;
      }

      const result = await UserBulkService.bulkAction(userIds, action, req.user!.id);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] bulkUserAction error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'action en masse",
      });
    }
  }

  /**
   * GET /api/admin/users/:userId/notes
   * Query params: page, limit
   */
  static async getUserNotes(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      if (!validateUserId(userId, res)) return;

      const { page, limit } = parsePagination(req.query as { page?: string; limit?: string });

      const result = await AdminNotesService.getNotes(userId, page, limit);
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] getUserNotes error:", error);
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
      if (!validateUserId(userId, res)) return;

      const parsed = CreateNoteSchema.safeParse(req.body);
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
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] createUserNote error:", error);
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
    } catch (error: unknown) {
      logger.error("[ADMIN_USER] deleteNote error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression de la note",
      });
    }
  }
}
