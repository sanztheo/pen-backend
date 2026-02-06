import type { Request, Response } from "express";
import { BetaService } from "../../services/BetaService.js";
import { logger } from "../../utils/logger.js";

export class StatusController {
  static async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const status = await BetaService.getStatus(userId);

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("[BETA_STATUS] Error fetching beta status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch beta status",
      });
    }
  }
}
