/**
 * Types legacy (deprecated, kept for backward compatibility)
 */

import { ToolCallRecord } from './common.types.js';
import { IntermediateThinkingBlock } from '../../../../types/ragThinking.js';

/**
 * @deprecated Use DecideToolsOptions + GenerateWithToolResultsOptions instead
 * Legacy interface kept for backward compatibility
 */
export interface FunctionCallingOptions {
  query: string;
  availableSources: Array<{ id: string; title: string; type: string }>;
  workspaceId: string;
  userId: string;
  useWeb: boolean;
  systemPrompt: string;
  isSearch?: boolean;  // 🔥 Flag pour Search mode
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
  timeoutMs?: number;
}

/**
 * @deprecated Use DecideToolsResult + GenerateWithToolResultsResult instead
 * Legacy interface kept for backward compatibility
 */
export interface FunctionCallingResult {
  content: string;
  toolCalls: ToolCallRecord[];
  thinking: string;
  usedFallback: boolean;
  intermediateThinkingBlocks: IntermediateThinkingBlock[]; // 🔥 NEW: Store blocks
}
