/**
 * Types pour la Phase 1 : Décision et exécution des tools
 */

import { ToolCallRecord } from './common.types.js';
import { IntermediateThinkingBlock } from '../../../../types/ragThinking.js';

/**
 * Options pour la Phase 1 : Décision et exécution des tools
 */
export interface DecideToolsOptions {
  query: string;
  availableSources: Array<{ id: string; title: string; type: string }>;
  workspaceId: string;
  userId: string;
  useWeb: boolean;
  systemPrompt: string;
  isSearch?: boolean;  // 🔥 Flag pour Search mode - permet plus de tools
  onThinking?: (thinking: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
  onIntermediateThinking?: (chunk: string) => void; // 🔥 NEW: Thinking entre les tools
}

/**
 * Résultat de la Phase 1
 */
export interface DecideToolsResult {
  toolCalls: ToolCallRecord[];
  thinking: string;
  shouldUseTools: boolean;
  intermediateThinkingBlocks: IntermediateThinkingBlock[]; // 🔥 NEW: Store all intermediate thinking
}
