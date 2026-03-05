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
