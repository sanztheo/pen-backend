/**
 * Types communs utilisés par le service de Function Calling
 */

import { IntermediateThinkingBlock } from '../../../../types/ragThinking.js';

/**
 * Enregistrement d'un appel de tool avec son résultat
 */
export interface ToolCallRecord {
  name: string;
  arguments: any;
  result: string;
  timestamp: number;
}
