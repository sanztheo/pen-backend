// ---------------------------------------------------------------------------
// Pennote AI Model Registry — Single source of truth
// Pricing last updated: 2026-02-27
// ---------------------------------------------------------------------------

import { logger } from "../utils/logger.js";

// ── Providers ──────────────────────────────────────────────────────────────

export type Provider = "openai" | "google" | "anthropic" | "deepseek" | "moonshot" | "xai";

// ── Model definition ───────────────────────────────────────────────────────

export interface ModelDef {
  id: string;
  provider: Provider;
  /** USD per 1 M tokens */
  pricing: { input: number; output: number };
  capabilities: {
    reasoning?: boolean;
    fixedTemp?: boolean;
    streaming?: boolean;
    structuredOutput?: boolean;
    embedding?: boolean;
    vision?: boolean;
    toolCalling?: boolean;
    maxContextTokens?: number;
    maxOutputTokens?: number;
  };
}

// ── Registry ───────────────────────────────────────────────────────────────
// Every model the platform may ever call lives here.
// Pricing = USD per 1 M tokens [input / output].

export const MODEL_REGISTRY: Record<string, ModelDef> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // OpenAI
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GPT-5 family (reasoning + generation) ──────────────────────────────
  "gpt-5.2": {
    // $1.75 / $14.00
    id: "gpt-5.2",
    provider: "openai",
    pricing: { input: 1.75, output: 14 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 400_000,
      maxOutputTokens: 128_000,
    },
  },
  "gpt-5.1": {
    // $1.25 / $10.00
    id: "gpt-5.1",
    provider: "openai",
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 400_000,
      maxOutputTokens: 128_000,
    },
  },
  "gpt-5": {
    // $1.25 / $10.00
    id: "gpt-5",
    provider: "openai",
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 400_000,
      maxOutputTokens: 128_000,
    },
  },
  "gpt-5-mini": {
    // $0.25 / $2.00
    id: "gpt-5-mini",
    provider: "openai",
    pricing: { input: 0.25, output: 2 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 128_000,
      maxOutputTokens: 64_000,
    },
  },
  "gpt-5-nano": {
    // $0.05 / $0.40
    id: "gpt-5-nano",
    provider: "openai",
    pricing: { input: 0.05, output: 0.4 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 64_000,
      maxOutputTokens: 32_000,
    },
  },

  // ── GPT-4.1 family (non-reasoning, 1M context) ────────────────────────
  "gpt-4.1": {
    // $2.00 / $8.00
    id: "gpt-4.1",
    provider: "openai",
    pricing: { input: 2, output: 8 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_047_576,
      maxOutputTokens: 32_768,
    },
  },
  "gpt-4.1-mini": {
    // $0.40 / $1.60
    id: "gpt-4.1-mini",
    provider: "openai",
    pricing: { input: 0.4, output: 1.6 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_047_576,
      maxOutputTokens: 32_768,
    },
  },
  "gpt-4.1-nano": {
    // $0.10 / $0.40
    id: "gpt-4.1-nano",
    provider: "openai",
    pricing: { input: 0.1, output: 0.4 },
    capabilities: {
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_047_576,
      maxOutputTokens: 16_384,
    },
  },

  // ── O-series (reasoning-first) ─────────────────────────────────────────
  o3: {
    // $2.00 / $8.00
    id: "o3",
    provider: "openai",
    pricing: { input: 2, output: 8 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 100_000,
    },
  },
  "o4-mini": {
    // $1.10 / $4.40
    id: "o4-mini",
    provider: "openai",
    pricing: { input: 1.1, output: 4.4 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 100_000,
    },
  },

  // ── GPT-4o (previous gen, still available) ─────────────────────────────
  "gpt-4o": {
    // $2.50 / $10.00
    id: "gpt-4o",
    provider: "openai",
    pricing: { input: 2.5, output: 10 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
    },
  },
  "gpt-4o-mini": {
    // $0.15 / $0.60
    id: "gpt-4o-mini",
    provider: "openai",
    pricing: { input: 0.15, output: 0.6 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
    },
  },

  // ── Embeddings ─────────────────────────────────────────────────────────
  "text-embedding-3-small": {
    // $0.02 / —
    id: "text-embedding-3-small",
    provider: "openai",
    pricing: { input: 0.02, output: 0 },
    capabilities: { embedding: true },
  },
  "text-embedding-3-large": {
    // $0.13 / —
    id: "text-embedding-3-large",
    provider: "openai",
    pricing: { input: 0.13, output: 0 },
    capabilities: { embedding: true },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Google Gemini
  // ═══════════════════════════════════════════════════════════════════════════

  "gemini-3.1-pro-preview": {
    // $1.25 / $10.00
    id: "gemini-3.1-pro-preview",
    provider: "google",
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 16_384,
    },
  },
  "gemini-3-flash-preview": {
    // $0.50 / $3.00
    id: "gemini-3-flash-preview",
    provider: "google",
    pricing: { input: 0.5, output: 3 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 65_536,
    },
  },
  "gemini-3-flash": {
    // $0.50 / $3.00
    id: "gemini-3-flash",
    provider: "google",
    pricing: { input: 0.5, output: 3 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 65_536,
    },
  },
  "gemini-2.5-pro": {
    // $1.25 / $10.00
    id: "gemini-2.5-pro",
    provider: "google",
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 65_536,
    },
  },
  "gemini-2.5-flash": {
    // $0.15 / $0.60
    id: "gemini-2.5-flash",
    provider: "google",
    pricing: { input: 0.15, output: 0.6 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 65_536,
    },
  },
  "gemini-2.5-flash-lite": {
    // $0.10 / $0.40
    id: "gemini-2.5-flash-lite",
    provider: "google",
    pricing: { input: 0.1, output: 0.4 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 65_536,
    },
  },
  "gemini-2.0-flash": {
    // $0.10 / $0.40
    id: "gemini-2.0-flash",
    provider: "google",
    pricing: { input: 0.1, output: 0.4 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 8_192,
    },
  },
  "gemini-2.0-flash-lite": {
    // $0.075 / $0.30
    id: "gemini-2.0-flash-lite",
    provider: "google",
    pricing: { input: 0.075, output: 0.3 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 8_192,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Anthropic Claude
  // ═══════════════════════════════════════════════════════════════════════════

  "claude-opus-4-6": {
    // $5.00 / $25.00
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: { input: 5, output: 25 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 128_000,
    },
  },
  "claude-sonnet-4-6": {
    // $3.00 / $15.00
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: { input: 3, output: 15 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 64_000,
    },
  },
  "claude-haiku-4-5": {
    // $1.00 / $5.00
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: { input: 1, output: 5 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 64_000,
    },
  },
  "claude-sonnet-4-5": {
    // $3.00 / $15.00
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    pricing: { input: 3, output: 15 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 64_000,
    },
  },
  "claude-3-5-haiku": {
    // $0.80 / $4.00
    id: "claude-3-5-haiku",
    provider: "anthropic",
    pricing: { input: 0.8, output: 4 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 200_000,
      maxOutputTokens: 8_192,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DeepSeek (V3.2 unified pricing)
  // ═══════════════════════════════════════════════════════════════════════════

  "deepseek-chat": {
    // $0.28 / $0.42
    id: "deepseek-chat",
    provider: "deepseek",
    pricing: { input: 0.28, output: 0.42 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
      maxContextTokens: 128_000,
      maxOutputTokens: 8_192,
    },
  },
  "deepseek-reasoner": {
    // $0.28 / $0.42
    id: "deepseek-reasoner",
    provider: "deepseek",
    pricing: { input: 0.28, output: 0.42 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      toolCalling: true,
      maxContextTokens: 128_000,
      maxOutputTokens: 64_000,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Moonshot / Kimi
  // ═══════════════════════════════════════════════════════════════════════════

  "kimi-k2.5": {
    // $0.45 / $2.20
    id: "kimi-k2.5",
    provider: "moonshot",
    pricing: { input: 0.45, output: 2.2 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 262_000,
      maxOutputTokens: 16_384,
    },
  },
  "kimi-k2.5-thinking": {
    // $0.45 / $2.20
    id: "kimi-k2.5-thinking",
    provider: "moonshot",
    pricing: { input: 0.45, output: 2.2 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 262_000,
      maxOutputTokens: 16_384,
    },
  },
  "kimi-k2-0905": {
    // $0.40 / $2.00
    id: "kimi-k2-0905",
    provider: "moonshot",
    pricing: { input: 0.4, output: 2 },
    capabilities: {
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
      maxContextTokens: 131_000,
      maxOutputTokens: 16_384,
    },
  },
  "kimi-k2-thinking": {
    // $0.47 / $2.00
    id: "kimi-k2-thinking",
    provider: "moonshot",
    pricing: { input: 0.47, output: 2 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
      maxContextTokens: 131_000,
      maxOutputTokens: 16_384,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // xAI (Grok)
  // ═══════════════════════════════════════════════════════════════════════════

  "grok-3": {
    // $3.00 / $15.00
    id: "grok-3",
    provider: "xai",
    pricing: { input: 3, output: 15 },
    capabilities: {
      reasoning: true,
      streaming: true,
      structuredOutput: true,
      vision: true,
      toolCalling: true,
      maxContextTokens: 131_072,
      maxOutputTokens: 16_384,
    },
  },
  "grok-3-mini": {
    // $0.30 / $0.50
    id: "grok-3-mini",
    provider: "xai",
    pricing: { input: 0.3, output: 0.5 },
    capabilities: {
      reasoning: true,
      fixedTemp: true,
      streaming: true,
      toolCalling: true,
      maxContextTokens: 131_072,
      maxOutputTokens: 16_384,
    },
  },
};

// ── Functional mapping ─────────────────────────────────────────────────────
// Each key = a use-case in Pennote.  Override via env var where noted.

function env(key: string): string | undefined {
  return process.env[key];
}

export const MODELS = {
  /** Chat agent principal (Gemini thinking) */
  AGENT_PRIMARY: env("AGENT_MODEL") || "gemini-3-flash-preview",
  /** Workflows — steps rapides */
  AGENT_FAST: "gemini-2.0-flash",
  /** Workflows — steps complexes (thinking) */
  AGENT_THINKING: "gemini-3-flash",

  /** Generation de questions quiz */
  QUIZ_GENERATION: env("OPENAI_QUIZ_GENERATION") || "gpt-5-mini",
  /** Correction de quiz */
  QUIZ_CORRECTION: env("OPENAI_QUIZ_CORRECTION") || "gpt-5-mini",

  /** Preprocessor quiz */
  PREPROCESSOR: "gpt-4o-mini",
  /** Extraction de concepts */
  EXTRACTION: "gpt-4o-mini",
  /** Clustering thematique */
  CLUSTERING: "gpt-4o-mini",
  /** Graphiques quiz + controller */
  GRAPHICS: "gpt-4o-mini",
  /** Fonctions assistant quiz */
  ASSISTANT_FUNCTIONS: "gpt-4o-mini",

  /** Taches legeres (titres quiz, RSS, micro-taches) */
  LIGHTWEIGHT: "gpt-4.1-nano",
  /** Validation pertinence RSS */
  RSS_VALIDATION: "gpt-4.1-nano",

  /** Generation contenu editeur (dashboard) */
  CONTENT_DEFAULT: env("OPENAI_DASHBOARD_MODEL") || env("OPENAI_MODEL") || "gpt-4o-mini",
  /** Detection type question RAG */
  DETECTION: env("OPENAI_DETECTION_MODEL") || "gpt-4o-mini",
  /** Titre de conversation */
  CONVERSATION_TITLE: "gpt-4o-mini",
  /** Recherche web (OpenAI Responses API) */
  WEB_SEARCH: "gpt-4o-mini",

  /** Embeddings RAG + concepts + documents */
  EMBEDDING: "text-embedding-3-small",
} as const;

/** Dimension of embedding vectors (text-embedding-3-small default) */
export const EMBEDDING_DIMENSION = 1536;

// ── Supported models list (for frontend content endpoint) ──────────────────

const modelsFromEnv = env("AI_SUPPORTED_MODELS")
  ?.split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export function getSupportedModels(): [string, ...string[]] {
  if (modelsFromEnv && modelsFromEnv.length > 0) {
    const validated = modelsFromEnv.filter((m) => {
      if (m in MODEL_REGISTRY) return true;
      logger.warn(`[MODELS] AI_SUPPORTED_MODELS contains unknown model "${m}" — skipped`);
      return false;
    });
    if (validated.length > 0) {
      return validated as [string, ...string[]];
    }
  }
  return ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini"];
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Startup validation ─────────────────────────────────────────────────────
for (const [key, modelId] of Object.entries(MODELS)) {
  if (typeof modelId === "number") continue;
  if (!(modelId in MODEL_REGISTRY)) {
    logger.warn(`[MODELS] MODELS.${key} = "${modelId}" is not in MODEL_REGISTRY`);
  }
}
