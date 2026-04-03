/**
 * Agent Models Route
 *
 * GET /models — Returns selectable models filtered by provider API key availability.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { AGENT_SELECTABLE_MODELS, MODELS } from "../../config/models.js";
import { getProviderInstance } from "../../config/providers.js";
import type { SelectableModel } from "../../config/models.js";
import { logger } from "../../utils/logger.js";

export const modelsRouter = Router();

modelsRouter.get("/models", (_req: Request, res: Response) => {
  try {
    logger.info("[Models] Fetching available models");

    // Filter models whose provider has a configured API key
    const availableModels: SelectableModel[] = AGENT_SELECTABLE_MODELS.filter((model) => {
      const provider = getProviderInstance(model.modelId);
      return provider !== undefined;
    });

    res.json({
      models: availableModels,
      defaultModelId: MODELS.AGENT_PRIMARY,
    });
  } catch (error) {
    logger.error("[Models] Failed to fetch available models:", error);
    res.status(500).json({ error: "Failed to fetch available models" });
  }
});
