/**
 * Exports publics des types du service Function Calling
 */

// Types communs
export type { ToolCallRecord, WikipediaSource } from './common.types.js';

// Types Phase 1
export type {
  DecideToolsOptions,
  DecideToolsResult
} from './phase1.types.js';

// Types Phase 2
export type {
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult
} from './phase2.types.js';

// Types Legacy (deprecated)
export type {
  FunctionCallingOptions,
  FunctionCallingResult
} from './legacy.types.js';
