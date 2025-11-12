/**
 * 🔧 FUNCTION CALLING SERVICE - Point d'entrée principal
 *
 * Ce module exporte tous les services et types nécessaires pour utiliser
 * le système de function calling en deux phases.
 */

// Export principal : La classe FunctionCallingService
export { FunctionCallingService } from './FunctionCallingService.js';

// Export des types
export type {
  // Types communs
  ToolCallRecord,
  // Types Phase 1
  DecideToolsOptions,
  DecideToolsResult,
  // Types Phase 2
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult,
  // Types Legacy (deprecated)
  FunctionCallingOptions,
  FunctionCallingResult
} from './types/index.js';

// Export des services (pour usage avancé)
export { Phase2Service } from './phases/index.js';
export { LegacyService } from './legacy/index.js';
export { PlannerService } from './planner.service.js';
export type { PlanRequest, Plan, ToolStep } from './planner.service.js';
export { ExecutorService } from './executor.service.js';
export type { ExecutionStep, ExecutionContext, ExecutionResult, ExecutionCallbacks } from './executor.service.js';
export { CoordinatorService } from './coordinator.service.js';
export type { OrchestrationRequest, OrchestrationResult } from './coordinator.service.js';

// 🚀 Export des services optimisés (architecture Cursor-inspired)
export { OptimizedExecutorService } from './executor.service.optimized.js';
export type { OptimizedExecutionContext, ToolExecutionPlan, BatchExecutionResult } from './executor.service.optimized.js';
export { ThinkingService } from './thinking.service.js';
export type { PhaseResult, ToolResult, ToolPlan, ReflectionResult } from './thinking.service.js';
export { CacheService } from './cache.service.js';
export type { CachedContext, ToolDescription } from './cache.service.js';
export { MetricsService } from './metrics.service.js';
export type { ExecutionMetrics } from './metrics.service.js';

// Export des utilitaires (pour usage avancé)
export {
  parseJSONFromStream,
  buildContextFromToolResults,
  buildInitialPrompt
} from './utils/index.js';
