import type { Request, Response } from "express";
import { BetaService } from "../../services/BetaService.js";
import { logger } from "../../utils/logger.js";

export class HeartbeatController {
  static async recordHeartbeat(req: Request, res: Response): Promise<void> {
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

      await BetaService.recordHeartbeat(userId);

      res.status(200).json({ success: true });
    } catch (error) {
      // Heartbeat failures should not crash — log and return 500
      logger.error("[BETA_HEARTBEAT] Error recording heartbeat:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record heartbeat",
      });
    }
  }
}
