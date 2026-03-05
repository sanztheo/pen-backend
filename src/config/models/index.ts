// ---------------------------------------------------------------------------
// Pennote AI Model Registry — Barrel export
// ---------------------------------------------------------------------------

// Re-export everything
export type { Provider, ModelDef } from "./types.js";
export { MODEL_REGISTRY } from "./registry.js";
export { MODELS, EMBEDDING_DIMENSION, getSupportedModels } from "./mapping.js";
export {
  isFixedTempModel,
  isReasoningModel,
  isNanoModel,
  isEmbeddingModel,
  getModelPricing,
  getModelProvider,
} from "./helpers.js";

// ── Startup validation ─────────────────────────────────────────────────────
import { logger } from "../../utils/logger.js";
import { MODEL_REGISTRY } from "./registry.js";
import { MODELS } from "./mapping.js";

for (const [key, modelId] of Object.entries(MODELS)) {
  if (typeof modelId === "number") continue;
  if (!(modelId in MODEL_REGISTRY)) {
    logger.warn(`[MODELS] MODELS.${key} = "${modelId}" is not in MODEL_REGISTRY`);
  }
}
