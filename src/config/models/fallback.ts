// ---------------------------------------------------------------------------
// Model Fallback System
// When a selected model is unaffordable or its provider is down,
// auto-switch to the best equivalent from another provider.
// Priority chain: Google (Gemini) > OpenAI > other providers.
// ---------------------------------------------------------------------------

import {
  AGENT_SELECTABLE_MODELS,
  CREDIT_TIERS,
  type SelectableModel,
  type RequiredPlan,
} from "./selectable.js";
import type { Provider } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FallbackReason = "insufficient_credits" | "provider_unavailable" | "plan_insufficient";

export interface FallbackResult {
  original: SelectableModel;
  fallback: SelectableModel;
  reason: FallbackReason;
}

// ── Provider preference (lower = tried first) ───────────────────────────────
// Order rationale: Gemini is cheapest to operate and most reliable.
// OpenAI second-cheapest. Anthropic last because it has the highest API cost
// at equivalent credit tiers, making it the least margin-friendly fallback.

const PROVIDER_PRIORITY: Record<Provider, number> = {
  google: 0,
  openai: 1,
  deepseek: 2,
  moonshot: 3,
  xai: 4,
  anthropic: 5,
};

// ── Plan rank (for filtering: user must have >= model's required plan) ──────

const PLAN_RANK: Record<RequiredPlan, number> = {
  free_user: 0,
  premium: 1,
  ultra: 2,
};

// ── Thinking level ordering for distance calculation ────────────────────────

const THINKING_LEVEL_ORDER: Record<string, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
};

function thinkingDistance(a: string, b: string): number {
  const ia = THINKING_LEVEL_ORDER[a] ?? 0;
  const ib = THINKING_LEVEL_ORDER[b] ?? 0;
  return Math.abs(ia - ib);
}

// ── Core fallback logic ─────────────────────────────────────────────────────

/**
 * Find the best fallback model for a given model.
 *
 * Scoring (lower = better):
 *   1. Credit tier distance (closest to original)
 *   2. Thinking level distance (closest to original)
 *   3. When equidistant from original, prefer higher-tier (more capable)
 *   4. Provider priority (google > openai > ...)
 *
 * @param original          The model the user selected
 * @param userPlan          The user's subscription plan (filters out inaccessible models)
 * @param isAffordable      Predicate: can the user afford this model's credit cost?
 * @param isProviderUp      Predicate: is this provider's API key configured?
 * @returns                 The best fallback model, or undefined if none exists
 */
export function findFallbackModel(
  original: SelectableModel,
  userPlan: RequiredPlan,
  isAffordable: (model: SelectableModel) => boolean,
  isProviderUp: (provider: Provider) => boolean,
): SelectableModel | undefined {
  const userRank = PLAN_RANK[userPlan];

  const candidates = AGENT_SELECTABLE_MODELS.filter(
    (m) =>
      m.id !== original.id &&
      m.provider !== original.provider &&
      PLAN_RANK[m.requiredPlan] <= userRank &&
      isAffordable(m) &&
      isProviderUp(m.provider),
  );

  if (candidates.length === 0) return undefined;

  const originalTierCost = CREDIT_TIERS[original.creditTier];

  // .filter() returns a new array — sort in-place is safe
  candidates.sort((a, b) => {
    // 1. Closest credit tier
    const tierDistA = Math.abs(CREDIT_TIERS[a.creditTier] - originalTierCost);
    const tierDistB = Math.abs(CREDIT_TIERS[b.creditTier] - originalTierCost);
    if (tierDistA !== tierDistB) return tierDistA - tierDistB;

    // 2. Closest thinking level
    const thinkDistA = thinkingDistance(a.thinkingLevel, original.thinkingLevel);
    const thinkDistB = thinkingDistance(b.thinkingLevel, original.thinkingLevel);
    if (thinkDistA !== thinkDistB) return thinkDistA - thinkDistB;

    // 3. When equidistant (one above, one below original), prefer higher-tier
    const tierCostA = CREDIT_TIERS[a.creditTier];
    const tierCostB = CREDIT_TIERS[b.creditTier];
    if (tierCostA !== tierCostB) return tierCostB - tierCostA;

    // 4. Provider priority: google > openai > others
    return PROVIDER_PRIORITY[a.provider] - PROVIDER_PRIORITY[b.provider];
  });

  return candidates[0];
}
