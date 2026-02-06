import type { Request, Response } from "express";
import { BetaService } from "../../services/BetaService.js";
import { logger } from "../../utils/logger.js";

export class ReactivateController {
  static async reactivate(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: "Authentication required",
          code: "MISSING_USER",
        });
        return;
      }

      const result = await BetaService.reactivateUser(userId);

      if (!result.success) {
        const statusCode = result.code === "NO_SPOTS_AVAILABLE" ? 403 : 400;
        res.status(statusCode).json({
          success: false,
          error: result.error,
          code: result.code,
        });
        return;
      }

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error("[BETA_REACTIVATE] Error reactivating user:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reactivate account",
      });
    }
  }
}
