/**
 * Types pour la Phase 2 : Génération finale avec résultats
 */

import { WikipediaSource } from './common.types.js';

/**
 * Options pour la Phase 2 : Génération finale avec résultats
 */
export interface GenerateWithToolResultsOptions {
  query: string;
  toolResults: string;
  systemPrompt: string;
  onStream?: (chunk: string) => void;
  wikipediaSources?: WikipediaSource[];
  conversationHistory?: string | null; // 🆕 Historique de conversation pour contexte
}

/**
 * Résultat de la Phase 2
 */
export interface GenerateWithToolResultsResult {
  content: string;
}
