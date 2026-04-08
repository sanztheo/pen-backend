import type { SubscriptionPlan } from "@prisma/client";

const VALID_PLANS = new Set<SubscriptionPlan>(["free_user", "premium", "ultra"]);

/**
 * Normalise un plan brut (depuis la DB) vers un SubscriptionPlan valide.
 * Retourne "free_user" si le plan est inconnu — loggable en amont si besoin.
 */
export function normalizePlan(raw: string | undefined | null): SubscriptionPlan {
  const plan = raw ?? "free_user";
  if (VALID_PLANS.has(plan as SubscriptionPlan)) return plan as SubscriptionPlan;
  return "free_user";
}

/** Vérifie si le plan est payant (Pro ou Ultra). */
export function isPaidPlan(plan: SubscriptionPlan): boolean {
  return plan === "premium" || plan === "ultra";
}
