// ---------------------------------------------------------------------------
// Pennote AI Model Registry — All model definitions
// Pricing last updated: 2026-02-27
// ---------------------------------------------------------------------------

import type { ModelDef } from "./types.js";

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
