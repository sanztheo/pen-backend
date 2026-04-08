/**
 * Agent Models Route
 *
 * GET /models — Returns ALL selectable models with locked/unavailable flags.
 * locked = user's plan is insufficient.
 * unavailable = provider API key not configured (fallback system handles it).
 */

import { Router } from "express";
import type { Response } from "express";
import { AGENT_SELECTABLE_MODELS, MODELS, getModelsForPlan } from "../../config/models.js";
import { isProviderAvailable } from "../../config/providers.js";
import type { RequiredPlan } from "../../config/models.js";
import { authenticateToken } from "../../middlewares/auth.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";

export const modelsRouter = Router();

modelsRouter.get("/models", authenticateToken, async (req, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Get user's subscription plan
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { plan: true },
    });
    const userPlan: RequiredPlan = (subscription?.plan as RequiredPlan) ?? "free_user";

    // Models accessible to this plan
    const accessibleIds = new Set(getModelsForPlan(userPlan).map((model) => model.id));

    // Return ALL models with locked flag (plan-gated)
    // The model fallback system handles provider unavailability transparently
    const modelsWithFlags = AGENT_SELECTABLE_MODELS.map((model) => ({
      ...model,
      locked: !accessibleIds.has(model.id),
      available: isProviderAvailable(model.provider),
    }));

    res.json({
      models: modelsWithFlags,
      defaultModelId: MODELS.AGENT_PRIMARY,
      userPlan,
    });
  } catch (error) {
    logger.error("[Models] Failed to fetch available models:", error);
    res.status(500).json({ error: "Failed to fetch available models" });
  }
});
