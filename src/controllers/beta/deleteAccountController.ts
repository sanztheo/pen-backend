import type { Request, Response } from "express";
import { AccountDeletionService } from "../../services/AccountDeletionService.js";
import { logger } from "../../utils/logger.js";

export class DeleteAccountController {
  static async deleteAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          code: "UNAUTHORIZED",
        });
        return;
      }

      if (req.impersonatedBy) {
        res.status(403).json({
          success: false,
          error: "Account deletion is not allowed during impersonation",
          code: "IMPERSONATION_BLOCKED",
        });
        return;
      }

      await AccountDeletionService.deleteUserCompletely(userId);

      res.status(200).json({ success: true, message: "Account deleted" });
    } catch (error) {
      logger.error("[ACCOUNT_DELETE] Error deleting account:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete account",
        code: "DELETION_FAILED",
      });
    }
  }
}
