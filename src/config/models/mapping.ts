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
  AGENT_PRIMARY: env("AGENT_MODEL") || "kimi-k2.5",
  /** Workflows — steps rapides, pas de thinking */
  AGENT_FAST: "kimi-k2.5",
  /** Workflows — steps complexes (thinking via providerOptions) */
  AGENT_THINKING: "kimi-k2.5",

  // ── Quiz ──────────────────────────────────────────────────────────────────
  /** Generation de questions quiz — thinking pour qualite */
  QUIZ_GENERATION: env("OPENAI_QUIZ_GENERATION") || "kimi-k2.5",
  /** Correction de quiz — thinking pour precision */
  QUIZ_CORRECTION: env("OPENAI_QUIZ_CORRECTION") || "kimi-k2.5",
  /** Preprocessor quiz — pas de thinking necessaire */
  PREPROCESSOR: "kimi-k2.5",
  /** Extraction de concepts */
  EXTRACTION: "kimi-k2.5",
  /** Clustering thematique */
  CLUSTERING: "kimi-k2.5",
  /** Graphiques quiz + controller */
  GRAPHICS: "kimi-k2.5",
  /** Fonctions assistant quiz */
  ASSISTANT_FUNCTIONS: "kimi-k2.5",

  // ── Taches legeres ────────────────────────────────────────────────────────
  /** Taches legeres (titres quiz, RSS, micro-taches) */
  LIGHTWEIGHT: "kimi-k2.5",
  /** Validation pertinence RSS */
  RSS_VALIDATION: "kimi-k2.5",

  // ── Contenu & detection ───────────────────────────────────────────────────
  /** Generation contenu editeur (dashboard) */
  CONTENT_DEFAULT: env("OPENAI_DASHBOARD_MODEL") || "kimi-k2.5",
  /** Detection type question RAG */
  DETECTION: env("OPENAI_DETECTION_MODEL") || "kimi-k2.5",
  /** Titre de conversation */
  CONVERSATION_TITLE: "kimi-k2.5",
  /** Recherche web (OpenAI Responses API — reste sur OpenAI) */
  WEB_SEARCH: "gpt-4o-mini",

  // ── Embeddings (OpenAI — Kimi n'a pas de modele embeddings) ───────────────
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
  return ["kimi-k2.5", "gpt-4o-mini", "gpt-5-mini"];
}
