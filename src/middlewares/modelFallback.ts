// ---------------------------------------------------------------------------
// Model Fallback Middleware
// Auto-switches to an equivalent model when the selected one is unaffordable
// or its provider is unavailable. Runs BEFORE requireAICredits.
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from "express";
import { findSelectableModel, PLAN_RANK, type RequiredPlan } from "../config/models/selectable.js";
import {
  findFallbackModel,
  type FallbackReason,
  type FallbackResult,
} from "../config/models/fallback.js";
import { AICreditsService } from "../services/credits/aiCreditsService.js";
import { isProviderAvailable } from "../config/providers.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

/**
 * Creates a middleware that auto-switches to a fallback model when:
 * 1. The user cannot afford the selected model's credit cost
 * 2. The selected model's provider API key is not configured
 *
 * Must be placed BEFORE requireAICredits in the middleware chain.
 */
export function modelFallback(dynamicCost: (req: Request) => number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Preserve original selection for safe rollback on error
    const originalModelSelection = req.body?.modelSelection;

    try {
      const userId = req.user?.id;
      const modelSelection =
        typeof originalModelSelection === "string" ? originalModelSelection : undefined;

      // No model selection = default eco model, no fallback needed
      if (!userId || !modelSelection) {
        next();
        return;
      }

      const selectedModel = findSelectableModel(modelSelection);
      if (!selectedModel) {
        next();
        return;
      }

      // Check provider availability (sync, O(1) map lookup)
      const providerUp = isProviderAvailable(selectedModel.provider);

      // Fetch credits + plan in parallel (single round of DB calls)
      const [remaining, subscription] = await Promise.all([
        AICreditsService.getRemainingCredits(userId),
        prisma.userSubscription.findUnique({
          where: { userId },
          select: { plan: true },
        }),
      ]);

      const userPlan: RequiredPlan = (subscription?.plan as RequiredPlan) ?? "free_user";
      const planAllowed = PLAN_RANK[userPlan] >= PLAN_RANK[selectedModel.requiredPlan];
      const isUnlimited = remaining === -1;
      const baseCost = dynamicCost(req);
      const totalCost = baseCost * selectedModel.creditMultiplier;
      const canAfford = isUnlimited || remaining >= totalCost;

      req.resolvedCredits = remaining;
      req.resolvedPlan = userPlan;

      if (providerUp && canAfford && planAllowed) {
        next();
        return;
      }

      const reason: FallbackReason = !planAllowed
        ? "plan_insufficient"
        : !providerUp
          ? "provider_unavailable"
          : "insufficient_credits";

      // Find the best fallback (plan-gated + credit-gated + provider-gated)
      const fallback = findFallbackModel(
        selectedModel,
        userPlan,
        (m) => {
          if (isUnlimited) return true;
          return remaining >= baseCost * m.creditMultiplier;
        },
        isProviderAvailable,
      );

      if (!fallback) {
        logger.warn(
          `[MODEL-FALLBACK] No fallback found for "${selectedModel.id}" (${reason}), proceeding with original`,
          { userId },
        );
        next();
        return;
      }

      // Apply fallback: mutate the request
      req.body.modelSelection = fallback.id;
      req.modelFallback = {
        original: selectedModel,
        fallback,
        reason,
      };

      logger.info(`[MODEL-FALLBACK] ${selectedModel.id} → ${fallback.id} (${reason})`, {
        userId,
        originalProvider: selectedModel.provider,
        fallbackProvider: fallback.provider,
        originalCost: selectedModel.creditMultiplier,
        fallbackCost: fallback.creditMultiplier,
      });

      next();
    } catch (error: unknown) {
      if (originalModelSelection !== undefined) {
        req.body.modelSelection = originalModelSelection;
      }
      delete req.modelFallback;

      const isPrismaConnError =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string" &&
        ["P2024", "P2025"].includes((error as { code: string }).code);

      if (isPrismaConnError) {
        logger.error("[MODEL-FALLBACK] DB connection error, failing closed", error);
        res.status(503).json({ error: "Service temporarily unavailable" });
        return;
      }

      logger.error(
        "[MODEL-FALLBACK] Error in fallback middleware, proceeding without fallback",
        error,
      );
      next();
    }
  };
}

// ── Extend Express Request type ─────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      modelFallback?: FallbackResult;
      resolvedCredits?: number;
      resolvedPlan?: string;
    }
  }
}
