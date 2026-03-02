import type { Request, Response } from "express";
import { AccountDeletionService } from "../../services/AccountDeletionService.js";
import { logger } from "../../utils/logger.js";

const LOG_PREFIX = "[DELETE_ACCOUNT]";

export class DeleteAccountController {
  static async deleteAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      // Guard: cannot delete while an admin is impersonating this session
      if (req.impersonatedBy) {
        res.status(403).json({
          success: false,
          error: "Cannot delete account while being impersonated",
          code: "IMPERSONATION_ACTIVE",
        });
        return;
      }

      await AccountDeletionService.deleteUserCompletely(userId);

      logger.log(`${LOG_PREFIX} Account deleted for user ${userId}`);
      res.status(200).json({ success: true });
    } catch (error: unknown) {
      logger.error(`${LOG_PREFIX} Error:`, error);
      res.status(500).json({ success: false, error: "Failed to delete account" });
    }
  }
}
