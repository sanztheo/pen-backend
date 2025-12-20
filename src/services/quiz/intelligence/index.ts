/**
 * 🧠 Quiz Intelligence Module
 * PEN-14 to PEN-24: Système intelligent de génération de quiz
 */

// Types
export * from "./types.js";

// Services
export { ConceptExtractorService } from "./conceptExtractor.js";
export {
  ThematicClustererService,
  type PageWithConcepts,
  type ThematicCluster,
  type ClusterOptions,
  type ClusterResult,
} from "./thematicClusterer.js";
export { SmartContentSelectorService } from "./smartContentSelector.js";

// Integration Helpers (PEN-18)
export {
  prepareIntelligentContext,
  getQuestionContext,
  createClustersDetectedEvent,
  type IntelligentGenerationConfig,
  type IntelligentContextResult,
  type ClusterQuestionDistribution,
} from "./integrationHelpers.js";
