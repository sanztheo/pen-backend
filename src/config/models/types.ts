// ---------------------------------------------------------------------------
// Pennote AI Model Registry — Types
// ---------------------------------------------------------------------------

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
