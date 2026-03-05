// ---------------------------------------------------------------------------
// Pennote AI — Model helper functions
// ---------------------------------------------------------------------------

import { logger } from "../../utils/logger.js";
import { MODEL_REGISTRY } from "./registry.js";
import type { Provider } from "./types.js";

/** Models that do not accept a `temperature` parameter. */
export function isFixedTempModel(modelId: string): boolean {
  const def = MODEL_REGISTRY[modelId];
  if (def?.capabilities.fixedTemp) return true;
  return /(o1|o3|o4|nano|gpt-5|kimi.*thinking|grok.*mini)/i.test(modelId);
}

/** Models that support reasoning / chain-of-thought. */
export function isReasoningModel(modelId: string): boolean {
  const def = MODEL_REGISTRY[modelId];
  if (def?.capabilities.reasoning) return true;
  return /(o1|o3|o4|gpt-5|deepseek-reasoner|thinking|claude-opus)/i.test(modelId);
}

/** Nano-class models — very cheap, generous token limits. */
export function isNanoModel(modelId: string): boolean {
  return /nano/i.test(modelId);
}

/** Embedding-only models. */
export function isEmbeddingModel(modelId: string): boolean {
  const def = MODEL_REGISTRY[modelId];
  return !!def?.capabilities.embedding;
}

/**
 * Returns pricing per 1 K tokens (NOT per 1 M — kept consistent with quotaManager).
 * Falls back to cheapest rate for unknown models.
 */
export function getModelPricing(modelId: string): {
  input: number;
  output: number;
} {
  const def = MODEL_REGISTRY[modelId];
  if (def) {
    return {
      input: def.pricing.input / 1000,
      output: def.pricing.output / 1000,
    };
  }
  logger.error(
    `[MODELS] Unknown model "${modelId}" — using fallback pricing (gpt-4o-mini rate). Check MODEL_REGISTRY.`,
  );
  return { input: 0.00015, output: 0.0006 };
}

/** Resolve the provider for a model id (returns undefined for unknown models). */
export function getModelProvider(modelId: string): Provider | undefined {
  const def = MODEL_REGISTRY[modelId];
  if (def) return def.provider;
  if (/grok/i.test(modelId)) return "xai";
  if (/gemini/i.test(modelId)) return "google";
  if (/claude/i.test(modelId)) return "anthropic";
  if (/deepseek/i.test(modelId)) return "deepseek";
  if (/kimi|moonshot/i.test(modelId)) return "moonshot";
  if (/gpt|o1|o3|o4|text-embedding/i.test(modelId)) return "openai";
  return undefined;
}
