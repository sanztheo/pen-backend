/**
 * 🔧 FUNCTION CALLING SERVICE - TWO-PHASE SYSTEM
 * Phase 1: AI décide des tools + stream explication + exécute tools
 * Phase 2: AI génère réponse finale avec résultats des tools
 *
 * Cette classe est une façade qui orchestre les différents services
 * de function calling de manière modulaire et maintainable.
 */

import { CoordinatorService } from './coordinator.service.js';
import { Phase2Service } from './phases/phase2.service.js';
import { LegacyService } from './legacy/legacy.service.js';
import { buildContextFromToolResults, buildInitialPrompt } from './utils/index.js';

// Types exports
import type {
  ToolCallRecord,
  DecideToolsOptions,
  DecideToolsResult,
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult,
  FunctionCallingOptions,
  FunctionCallingResult
} from './types/index.js';

/**
 * Service principal de Function Calling
 *
 * Cette classe orchestre les deux phases du système de function calling :
 * - Phase 1 : Décision et exécution des tools
 * - Phase 2 : Génération de la réponse finale
 */
export class FunctionCallingService {
  /**
   * 🔥 PHASE 1: Décision et exécution des tools
   *
   * Cette méthode implémente une boucle agentic avec :
   * - First thinking : génère un plan JSON avec la séquence de tools
   * - Intermediate thinking : génère du JSON avec les arguments pour chaque tool
   * - Exécution des tools avec les arguments dérivés du thinking
   *
   * @deprecated Use CoordinatorService.orchestrate() directly for new code
   */
  static async decideAndExecuteTools(
    options: DecideToolsOptions
  ): Promise<DecideToolsResult> {
    // Redirect to CoordinatorService for backward compatibility
    const result = await CoordinatorService.orchestrate({
      query: options.query,
      workspaceId: options.workspaceId,
      userId: options.userId,
      availableSources: options.availableSources,
      useWeb: options.useWeb,
      isSearch: options.isSearch ?? false, // Default to ask mode if not specified
      systemPrompt: options.systemPrompt,
      onThinking: options.onThinking,
      onToolCall: options.onToolCall,
      onToolResult: options.onToolResult,
      onIntermediateThinking: options.onIntermediateThinking
    });

    // Map OrchestrationResult to DecideToolsResult
    return {
      toolCalls: result.toolCalls,
      thinking: result.thinking,
      shouldUseTools: result.success,
      intermediateThinkingBlocks: result.intermediateThinkingBlocks
    };
  }

  /**
   * 🔥 PHASE 2: Génération de la réponse finale
   *
   * Cette méthode prend les résultats des tools et génère une réponse
   * structurée et précise pour l'utilisateur.
   */
  static async generateWithToolResults(
    options: GenerateWithToolResultsOptions
  ): Promise<GenerateWithToolResultsResult> {
    return Phase2Service.generateWithToolResults(options);
  }

  /**
   * @deprecated Use decideAndExecuteTools + generateWithToolResults instead
   * Legacy method kept for backward compatibility
   *
   * Cette méthode combine les phases 1 et 2 en un seul appel pour
   * maintenir la compatibilité avec l'ancien code.
   */
  static async generateWithTools(
    options: FunctionCallingOptions
  ): Promise<FunctionCallingResult> {
    return LegacyService.generateWithTools(options);
  }

  /**
   * 🔥 Helper: Construit le contexte pour Phase 2 à partir des résultats des tools
   */
  static buildContextFromToolResults = buildContextFromToolResults;

  /**
   * Helper: Construit le prompt initial avec la liste des sources disponibles
   * @private
   */
  static buildInitialPrompt = buildInitialPrompt;
}

// Re-export types for convenience
export type {
  ToolCallRecord,
  DecideToolsOptions,
  DecideToolsResult,
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult,
  FunctionCallingOptions,
  FunctionCallingResult
};
