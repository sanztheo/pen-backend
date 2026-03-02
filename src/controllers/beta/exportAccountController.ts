import type { Request, Response } from "express";
import { AccountExportService } from "../../services/AccountExportService.js";
import { logger } from "../../utils/logger.js";

const LOG_PREFIX = "[EXPORT_ACCOUNT]";

export class ExportAccountController {
  static async exportData(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      // Guard: GDPR export should be the user's own action, not an admin's
      if (req.impersonatedBy) {
        res.status(403).json({
          success: false,
          error: "Cannot export account data while being impersonated",
          code: "IMPERSONATION_ACTIVE",
        });
        return;
      }

      const data = await AccountExportService.exportUserData(userId);

      logger.log(`${LOG_PREFIX} Data exported for user ${userId}`);
      res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      logger.error(`${LOG_PREFIX} Error:`, error);
      res.status(500).json({ success: false, error: "Failed to export account data" });
    }
  }
}
