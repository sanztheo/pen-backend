// ---------------------------------------------------------------------------
// Pennote AI — Agent Selectable Models
// Models exposed to users in the Model Selector dropdown.
// Each entry = model + thinking level (composite ID).
// ---------------------------------------------------------------------------

import type { Provider } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "standard" | "premium";

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
  /** Pricing tier — all "standard" for V1 */
  tier: ModelTier;
}

// ── Selectable models ────────────────────────────────────────────────────────

export const AGENT_SELECTABLE_MODELS: readonly SelectableModel[] = [
  // Gemini 3 Flash Preview — 4 thinking levels
  {
    id: "gemini-3-flash-preview:minimal",
    modelId: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    icon: "google",
    thinkingLevel: "minimal",
    tier: "standard",
  },
  {
    id: "gemini-3-flash-preview:low",
    modelId: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    icon: "google",
    thinkingLevel: "low",
    tier: "standard",
  },
  {
    id: "gemini-3-flash-preview:medium",
    modelId: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    icon: "google",
    thinkingLevel: "medium",
    tier: "standard",
  },
  {
    id: "gemini-3-flash-preview:high",
    modelId: "gemini-3-flash-preview",
    name: "Gemini 3 Flash Preview",
    provider: "google",
    icon: "google",
    thinkingLevel: "high",
    tier: "standard",
  },
  // GPT-4.1 Nano — ultra-cheap, no reasoning, 1M context
  {
    id: "gpt-4.1-nano:none",
    modelId: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    icon: "openai",
    thinkingLevel: "none",
    tier: "standard",
  },
  // GPT-5 Nano — cheapest GPT-5, basic reasoning
  {
    id: "gpt-5-nano:low",
    modelId: "gpt-5-nano",
    name: "GPT-5 Nano",
    provider: "openai",
    icon: "openai",
    thinkingLevel: "low",
    tier: "standard",
  },
  // GPT-5 Nano high & GPT-5 Mini high: removed — empty response bug with reasoning streaming
  // Codex Mini — code specialist, great with tools
  {
    id: "gpt-5.1-codex-mini:low",
    modelId: "gpt-5.1-codex-mini",
    name: "Codex Mini",
    provider: "openai",
    icon: "openai",
    thinkingLevel: "low",
    tier: "standard",
  },
  {
    id: "gpt-5.1-codex-mini:medium",
    modelId: "gpt-5.1-codex-mini",
    name: "Codex Mini",
    provider: "openai",
    icon: "openai",
    thinkingLevel: "medium",
    tier: "standard",
  },
  {
    id: "gpt-5.1-codex-mini:high",
    modelId: "gpt-5.1-codex-mini",
    name: "Codex Mini",
    provider: "openai",
    icon: "openai",
    thinkingLevel: "high",
    tier: "standard",
  },
  // Kimi K2.5 — 256K context, multimodal, $0.45/$2.20
  {
    id: "kimi-k2.5:none",
    modelId: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshot",
    icon: "moonshot",
    thinkingLevel: "none",
    tier: "standard",
  },
  {
    id: "kimi-k2.5:medium",
    modelId: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshot",
    icon: "moonshot",
    thinkingLevel: "medium",
    tier: "standard",
  },
] as const;

// ── Tier multiplier (prepared for future premium support, NOT wired) ─────────

export const TIER_MULTIPLIER: Record<ModelTier, number> = {
  standard: 1,
  premium: 2,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lookup a selectable model by composite ID. Returns undefined if not found. */
export function findSelectableModel(compositeId: string): SelectableModel | undefined {
  return AGENT_SELECTABLE_MODELS.find((m) => m.id === compositeId);
}

/** Parse a composite ID into modelId + thinkingLevel. Returns undefined on invalid format. */
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
