// ---------------------------------------------------------------------------
// Pennote AI Provider Instances — Vercel AI SDK
// Each provider is lazily guarded on its API key. Missing key = undefined.
// ---------------------------------------------------------------------------

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createKimi } from "kimi-vercel-ai-sdk-provider";
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

export const kimiProvider = process.env.KIMI_API_KEY
  ? createKimi({ apiKey: process.env.KIMI_API_KEY })
  : undefined;

// ── Provider resolution ────────────────────────────────────────────────────

type AnyProvider =
  | ReturnType<typeof createGoogleGenerativeAI>
  | ReturnType<typeof createOpenAI>
  | ReturnType<typeof createDeepSeek>
  | ReturnType<typeof createAnthropic>
  | ReturnType<typeof createXai>
  | ReturnType<typeof createKimi>
  | undefined;

const PROVIDER_MAP: Record<Provider, AnyProvider> = {
  openai: openaiProvider,
  google,
  anthropic: anthropicProvider,
  deepseek: deepseekProvider,
  moonshot: kimiProvider,
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
