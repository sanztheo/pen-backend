/**
 * Service Legacy (deprecated)
 *
 * @deprecated Use CoordinatorService.orchestrate() + Phase2Service.generateWithToolResults instead
 * Legacy method kept for backward compatibility
 */

import { AIService } from '../../base.js';
import { CoordinatorService } from '../coordinator.service.js';
import { Phase2Service } from '../phases/phase2.service.js';
import { buildContextFromToolResults } from '../utils/contextBuilder.js';
import type { FunctionCallingOptions, FunctionCallingResult } from '../types/legacy.types.js';

/**
 * Service legacy pour la compatibilité avec l'ancienne API
 */
export class LegacyService {
  /**
   * @deprecated Use CoordinatorService.orchestrate() + Phase2Service.generateWithToolResults instead
   * Legacy method kept for backward compatibility
   */
  static async generateWithTools(
    options: FunctionCallingOptions
  ): Promise<FunctionCallingResult> {
    console.warn('[DEPRECATED] generateWithTools() is deprecated. Use CoordinatorService.orchestrate() instead.');

    const {
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      onThinking,
      onToolCall,
      onToolResult
    } = options;

    // Phase 1: Decide and execute tools
    const toolDecision = await CoordinatorService.orchestrate({
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      isSearch: false, // Legacy mode defaults to ask mode
      systemPrompt,
      onThinking,
      onToolCall,
      onToolResult
    });

    // Phase 2: Generate with tool results
    if (toolDecision.success) {
      const toolResults = buildContextFromToolResults(toolDecision.toolCalls);
      const finalResponse = await Phase2Service.generateWithToolResults({
        query,
        toolResults,
        systemPrompt,
        onStream: () => {} // No streaming in legacy mode
      });

      return {
        content: finalResponse.content,
        toolCalls: toolDecision.toolCalls,
        thinking: toolDecision.thinking,
        usedFallback: false,
        intermediateThinkingBlocks: toolDecision.intermediateThinkingBlocks
      };
    }

    // No tools used, generate directly
    const fallbackContent = await AIService.generateContent({
      prompt: query,
      context: systemPrompt,
      temperature: 0.2,
      maxTokens: 4000
    });

    return {
      content: fallbackContent.content,
      toolCalls: [],
      thinking: toolDecision.thinking,
      usedFallback: true,
      intermediateThinkingBlocks: toolDecision.intermediateThinkingBlocks
    };
  }
}
