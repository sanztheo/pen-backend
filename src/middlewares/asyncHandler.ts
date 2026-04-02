import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";

/**
 * Wraps an async Express route handler to catch unhandled rejections.
 * Eliminates the repetitive try/catch + 500 pattern across route files.
 *
 * Usage:
 *   router.get("/foo", asyncHandler(async (req, res) => { ... }));
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[AsyncHandler] Unhandled error: ${message}`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };
};
