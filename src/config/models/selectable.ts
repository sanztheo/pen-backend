// ---------------------------------------------------------------------------
// Pennote AI — Agent Selectable Models (3-Tier Pricing)
// Models exposed to users in the Model Selector dropdown.
// Each entry = model + thinking level + credit cost + required plan.
// ---------------------------------------------------------------------------

import type { Provider } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type CreditTier = "eco" | "standard" | "premium" | "elite";
export type RequiredPlan = "free_user" | "premium" | "ultra";

export interface SelectableModel {
  /** Composite ID: "modelId:thinkingLevel" */
  id: string;
  /** Real model ID for the AI SDK */
  modelId: string;
  /** Display name (provider-agnostic) */
  name: string;
  /** AI provider */
  provider: Provider;
  /** Icon identifier for the frontend */
  icon: string;
  /** Provider-specific thinking/reasoning level */
  thinkingLevel: string;
  /** Credit tier for pricing */
  creditTier: CreditTier;
  /** Credits consumed per action */
  creditMultiplier: number;
  /** Minimum plan required to use this model */
  requiredPlan: RequiredPlan;
}

// ── Backwards compat aliases ────────────────────────────────────────────────

// ── Credit tiers ─────────────────────────────────────────────────────────────

export const CREDIT_TIERS: Record<CreditTier, number> = {
  eco: 1,
  standard: 2,
  premium: 3,
  elite: 5,
};

// ── Plan rank (for filtering: higher rank includes all lower plans) ──────────

export const PLAN_RANK: Record<RequiredPlan, number> = {
  free_user: 0,
  premium: 1,
  ultra: 2,
};

// ── Helper to build model entry ──────────────────────────────────────────────

function m(
  modelId: string,
  name: string,
  provider: Provider,
  icon: string,
  thinkingLevel: string,
  creditTier: CreditTier,
  requiredPlan: RequiredPlan,
): SelectableModel {
  return {
    id: `${modelId}:${thinkingLevel}`,
    modelId,
    name,
    provider,
    icon,
    thinkingLevel,
    creditTier,
    creditMultiplier: CREDIT_TIERS[creditTier],
    requiredPlan,
  };
}

// ── Selectable models ────────────────────────────────────────────────────────
//
// Organized by credit tier. requiredPlan determines minimum plan:
//   free_user = visible to all (but Free users get NO model choice — backend picks default)
//   premium   = visible to Pro + Ultra
//   ultra     = visible to Ultra only
//
// Free plan: backend auto-selects default eco model, user sees "AI" not model names.
// Pro plan:  user picks from eco models (requiredPlan <= "premium").
// Ultra plan: user picks from ALL models.

export const AGENT_SELECTABLE_MODELS: readonly SelectableModel[] = [
  // ── Tier 1: Eco (1 credit) — Free/Pro/Ultra ────────────────────────────────

  // Gemini 3 Flash Preview — 4 thinking levels
  m(
    "gemini-3-flash-preview",
    "Gemini 3 Flash Preview",
    "google",
    "google",
    "minimal",
    "eco",
    "free_user",
  ),
  m(
    "gemini-3-flash-preview",
    "Gemini 3 Flash Preview",
    "google",
    "google",
    "low",
    "eco",
    "free_user",
  ),
  m(
    "gemini-3-flash-preview",
    "Gemini 3 Flash Preview",
    "google",
    "google",
    "medium",
    "eco",
    "free_user",
  ),
  m(
    "gemini-3-flash-preview",
    "Gemini 3 Flash Preview",
    "google",
    "google",
    "high",
    "eco",
    "free_user",
  ),

  // Gemini 2.5 Flash
  m("gemini-2.5-flash", "Gemini 2.5 Flash", "google", "google", "none", "eco", "free_user"),
  m(
    "gemini-2.5-flash-lite",
    "Gemini 2.5 Flash Lite",
    "google",
    "google",
    "none",
    "eco",
    "free_user",
  ),

  // Gemini 3.1 Flash Lite Preview
  m(
    "gemini-3.1-flash-lite-preview",
    "Gemini 3.1 Flash Lite",
    "google",
    "google",
    "none",
    "eco",
    "free_user",
  ),

  // GPT Nano series
  m("gpt-4.1-nano", "GPT-4.1 Nano", "openai", "openai", "none", "eco", "free_user"),
  m("gpt-5-nano", "GPT-5 Nano", "openai", "openai", "low", "eco", "free_user"),
  m("gpt-5.4-nano", "GPT-5.4 Nano", "openai", "openai", "low", "eco", "free_user"),

  // GPT Mini series
  m("gpt-4.1-mini", "GPT-4.1 Mini", "openai", "openai", "none", "eco", "free_user"),
  m("gpt-4o-mini", "GPT-4o Mini", "openai", "openai", "none", "eco", "free_user"),

  // Codex Mini — Pro-selectable eco model
  m("gpt-5.1-codex-mini", "Codex Mini", "openai", "openai", "low", "eco", "premium"),
  m("gpt-5.1-codex-mini", "Codex Mini", "openai", "openai", "medium", "eco", "premium"),
  m("gpt-5.1-codex-mini", "Codex Mini", "openai", "openai", "high", "eco", "premium"),

  // Kimi K2.5 — Pro-selectable eco model
  m("kimi-k2.5", "Kimi K2.5", "moonshot", "moonshot", "none", "eco", "premium"),
  m("kimi-k2.5", "Kimi K2.5", "moonshot", "moonshot", "medium", "eco", "premium"),
  m("kimi-k2-0905", "Kimi K2", "moonshot", "moonshot", "none", "eco", "free_user"),

  // DeepSeek — Pro-selectable eco model
  m("deepseek-chat", "DeepSeek Chat", "deepseek", "deepseek", "none", "eco", "premium"),
  m("deepseek-reasoner", "DeepSeek Reasoner", "deepseek", "deepseek", "none", "eco", "free_user"),

  // Gemma 4 — Free models, Pro-selectable, tool calling + thinking
  m("gemma-4-31b-it", "Gemma 4 31B", "google", "google", "none", "eco", "premium"),
  m("gemma-4-26b-a4b-it", "Gemma 4 MoE", "google", "google", "none", "eco", "premium"),
  m("gemma-4-e4b-it", "Gemma 4 Mini", "google", "google", "none", "eco", "premium"),

  // ── Tier 2: Standard (2 credits) — Ultra only ─────────────────────────────

  m("gpt-5", "GPT-5", "openai", "openai", "low", "standard", "ultra"),
  m("gpt-5-mini", "GPT-5 Mini", "openai", "openai", "low", "standard", "ultra"),
  m("gpt-5.1", "GPT-5.1", "openai", "openai", "low", "standard", "ultra"),
  m("gemini-2.5-pro", "Gemini 2.5 Pro", "google", "google", "none", "standard", "ultra"),
  m("gemini-3.1-pro-preview", "Gemini 3.1 Pro", "google", "google", "none", "standard", "ultra"),
  m("gpt-4.1", "GPT-4.1", "openai", "openai", "none", "standard", "ultra"),
  m("o4-mini", "o4-mini", "openai", "openai", "medium", "standard", "ultra"),
  m("kimi-k2-thinking", "Kimi K2 Thinking", "moonshot", "moonshot", "high", "standard", "ultra"),
  m("grok-3-mini", "Grok 3 Mini", "xai", "xai", "low", "standard", "ultra"),
  m("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic", "anthropic", "none", "standard", "ultra"),

  // ── Tier 3: Premium (3 credits) — Ultra only ──────────────────────────────

  m("claude-sonnet-4-5", "Claude Sonnet 4.5", "anthropic", "anthropic", "none", "premium", "ultra"),
  m("claude-sonnet-4-6", "Claude Sonnet 4.6", "anthropic", "anthropic", "none", "premium", "ultra"),
  m("gpt-5.2", "GPT-5.2", "openai", "openai", "low", "premium", "ultra"),
  m("gpt-4o", "GPT-4o", "openai", "openai", "none", "premium", "ultra"),
  m("o3", "o3", "openai", "openai", "high", "premium", "ultra"),
  m("grok-3", "Grok 3", "xai", "xai", "none", "premium", "ultra"),

  // ── Tier 4: Elite (5 credits) — Ultra only ─────────────────────────────────

  m("claude-opus-4-6", "Claude Opus 4.6", "anthropic", "anthropic", "none", "elite", "ultra"),
];

// ── O(1) index built once at module load ────────────────────────────────────

const MODEL_MAP = new Map<string, SelectableModel>(
  AGENT_SELECTABLE_MODELS.map((model) => [model.id, model]),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lookup a selectable model by composite ID (O(1)). */
export function findSelectableModel(compositeId: string): SelectableModel | undefined {
  return MODEL_MAP.get(compositeId);
}

/** Parse a composite ID into modelId + thinkingLevel. */
export function parseCompositeId(
  compositeId: string,
): { modelId: string; thinkingLevel: string } | undefined {
  const colonIndex = compositeId.indexOf(":");
  if (colonIndex === -1) return undefined;
  const modelId = compositeId.slice(0, colonIndex);
  const thinkingLevel = compositeId.slice(colonIndex + 1);
  if (!modelId || !thinkingLevel) return undefined;
  return { modelId, thinkingLevel };
}

/** Get all models accessible to a given plan (includes lower-tier plans). */
export function getModelsForPlan(plan: RequiredPlan): SelectableModel[] {
  const userRank = PLAN_RANK[plan];
  return AGENT_SELECTABLE_MODELS.filter((model) => PLAN_RANK[model.requiredPlan] <= userRank);
}

/** Get credit multiplier for a model by composite ID. Returns 1 (eco) if not found. */
export function getCreditMultiplier(compositeId: string): number {
  const model = findSelectableModel(compositeId);
  return model?.creditMultiplier ?? 1;
}
