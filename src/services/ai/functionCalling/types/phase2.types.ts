/**
 * Types pour la Phase 2 : Génération finale avec résultats
 */

/**
 * Options pour la Phase 2 : Génération finale avec résultats
 */
export interface GenerateWithToolResultsOptions {
  query: string;
  toolResults: string;
  systemPrompt: string;
  onStream?: (chunk: string) => void;
}

/**
 * Résultat de la Phase 2
 */
export interface GenerateWithToolResultsResult {
  content: string;
}
