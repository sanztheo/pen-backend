/**
 * Types communs utilisés par le service de Function Calling
 */

import { IntermediateThinkingBlock } from '../../../../types/ragThinking.js';
import type { ToolResultScore } from '../scoring.service.js';

/**
 * Enregistrement d'un appel de tool avec son résultat
 */
export interface ToolCallRecord {
  name: string;
  arguments: any;
  result: string;
  score?: ToolResultScore;  // 🆕 Score de qualité du résultat (feedback loop)
  timestamp: number;
}

/**
 * Source Wikipedia avec ses métadonnées pour attribution de licence
 */
export interface WikipediaSource {
  title: string;
  url: string;
  pageid: number;
}
