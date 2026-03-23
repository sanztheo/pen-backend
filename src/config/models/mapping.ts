// ---------------------------------------------------------------------------
// Pennote AI — Functional model mapping (use-case → model id)
// ---------------------------------------------------------------------------

import { logger } from "../../utils/logger.js";
import { MODEL_REGISTRY } from "./registry.js";

// ── Env helper ─────────────────────────────────────────────────────────────

function env(key: string): string | undefined {
  return process.env[key];
}

// ── Functional mapping ─────────────────────────────────────────────────────
// Each key = a use-case in Pennote. Override via env var where noted.

export const MODELS = {
  // ── Agent (chat principal) ────────────────────────────────────────────────
  /** Chat agent principal — thinking contrôlé via providerOptions */
  AGENT_PRIMARY: env("AGENT_MODEL") || "gemini-3-flash-preview",
  /** Workflows — steps rapides, pas de thinking */
  AGENT_FAST: "gemini-3-flash-preview",
  /** Workflows — steps complexes (thinking via providerOptions) */
  AGENT_THINKING: "gemini-3-flash-preview",

  // ── Quiz (Gemini 3 Flash — reasoning + structured output) ────────────────
  /** Generation de questions quiz */
  QUIZ_GENERATION: "gemini-3-flash-preview",
  /** Correction de quiz */
  QUIZ_CORRECTION: "gemini-3-flash-preview",
  /** Batch explanation generation during correction */
  QUIZ_EXPLANATION: "gemini-3-flash-preview",
  /** Preprocessor quiz */
  PREPROCESSOR: "gemini-3-flash-preview",
  /** Extraction de concepts */
  EXTRACTION: "gemini-3-flash-preview",
  /** Clustering thematique */
  CLUSTERING: "gemini-3-flash-preview",
  /** Graphiques quiz + controller */
  GRAPHICS: "gemini-3-flash-preview",
  /** Fonctions assistant quiz */
  ASSISTANT_FUNCTIONS: "gemini-3-flash-preview",

  // ── Taches legeres ────────────────────────────────────────────────────────
  /** Taches legeres (titres quiz, RSS, micro-taches) */
  LIGHTWEIGHT: "gemini-3-flash-preview",
  /** Validation pertinence RSS */
  RSS_VALIDATION: "gpt-5-nano",

  // ── Contenu & detection ───────────────────────────────────────────────────
  /** Generation contenu editeur (dashboard) */
  CONTENT_DEFAULT: env("OPENAI_DASHBOARD_MODEL") || "gemini-3-flash-preview",
  /** Detection type question RAG */
  DETECTION: env("OPENAI_DETECTION_MODEL") || "gemini-3-flash-preview",
  /** Titre de conversation */
  CONVERSATION_TITLE: "gemini-3-flash-preview",
  /** Recherche web (OpenAI Responses API — reste sur OpenAI) */
  WEB_SEARCH: "gpt-4o-mini",

  // ── Embeddings (OpenAI) ──────────────────────────────────────────────────
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
  return ["gemini-3-flash-preview", "gpt-4o-mini", "gpt-5-mini"];
}
