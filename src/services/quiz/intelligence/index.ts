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

// Question Scorer (PEN-19)
export {
  QuestionScorerService,
  type QuestionScore,
  type DuplicateCheckResult,
  type ScoringConfig,
} from "./questionScorer.js";

// Context Cache (PEN-20)
export { ContextCacheService, type CachedContext } from "./contextCache.js";

// Correction Enricher (PEN-22)
export {
  CorrectionEnricherService,
  type SourceReference,
  type ConceptToReview,
  type EnrichedQuestionResult,
  type EnrichmentConfig,
} from "./correctionEnricher.js";

// Course Analyzer — Pipeline v5 Step [1]: Analyze
export {
  analyzeCourse,
  ConceptSchema,
  ConceptMapSchema,
  type Concept,
  type ConceptMap,
  type ChatClient,
  type AnalyzeCourseOptions,
} from "./courseAnalyzer.js";

// Quiz Planner — Pipeline v5 Step [2]: Plan
export {
  planQuiz,
  QuizPlanConfigSchema,
  QuizBlueprintSchema,
  type QuizPlanConfig,
  type PlannedQuestion,
  type QuizBlueprint,
  type PlanQuizOptions,
} from "./quizPlanner.js";
