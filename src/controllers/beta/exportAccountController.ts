import type { Request, Response } from "express";
import { AccountExportService } from "../../services/AccountExportService.js";
import { logger } from "../../utils/logger.js";

export class ExportAccountController {
  static async exportAccount(req: Request, res: Response): Promise<void> {
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
          error: "Data export is not allowed during impersonation",
          code: "IMPERSONATION_BLOCKED",
        });
        return;
      }

      const data = await AccountExportService.exportUserData(userId);

      res.status(200).json({ success: true, data });
    } catch (error) {
      logger.error("[ACCOUNT_EXPORT] Error exporting account data:", error);
      res.status(500).json({
        success: false,
        error: "Failed to export account data",
        code: "EXPORT_FAILED",
      });
    }
  }
}
