// ---------------------------------------------------------------------------
// Pennote AI Provider Instances — Vercel AI SDK
// Each provider is lazily guarded on its API key. Missing key = undefined.
// ---------------------------------------------------------------------------

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { getModelProvider, type Provider } from "./models.js";

// ── Provider instances ─────────────────────────────────────────────────────

export const google =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? createGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      })
    : undefined;

export const openaiProvider = process.env.OPENAI_API_KEY
  ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : undefined;

export const deepseekProvider = process.env.DEEPSEEK_API_KEY
  ? createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY })
  : undefined;

export const anthropicProvider = process.env.ANTHROPIC_API_KEY
  ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : undefined;

export const xaiProvider = process.env.XAI_API_KEY
  ? createXai({ apiKey: process.env.XAI_API_KEY })
  : undefined;

// Kimi via provider officiel @ai-sdk/moonshotai (spec v3, compatible AI SDK v6)
const MOONSHOT_KEY = process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
export const moonshotProvider = MOONSHOT_KEY
  ? createMoonshotAI({ apiKey: MOONSHOT_KEY })
  : undefined;

// ── Provider resolution ────────────────────────────────────────────────────

type AnyProvider =
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createMoonshotAI>
  | ReturnType<typeof createDeepSeek>
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createXai>
  | undefined;

const PROVIDER_MAP: Record<Provider, AnyProvider> = {
  openai: openaiProvider,
  google,
  anthropic: anthropicProvider,
  deepseek: deepseekProvider,
  moonshot: moonshotProvider,
  xai: xaiProvider,
};

/**
 * Resolve the correct Vercel AI SDK provider instance for a given model id.
 * Returns undefined if the provider's API key is not configured.
 */
export function getProviderInstance(modelId: string): AnyProvider {
  const provider = getModelProvider(modelId);
  if (!provider) return undefined;
  return PROVIDER_MAP[provider];
}

/**
 * Check if a provider has its API key configured and is available.
 */
export function isProviderAvailable(provider: Provider): boolean {
  return PROVIDER_MAP[provider] !== undefined;
}
