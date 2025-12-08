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
  conversationHistory?: string | null; // Historique de conversation pour contexte
  personalization?: any; // Données de personnalisation utilisateur
  model?: string; // Modèle spécifique à utiliser
  // Delta approach (Perplexity-style)
  wave1Response?: string; // Réponse partielle de Vague 1 à enrichir
  partialToolCount?: number; // Nombre de tools utilisés pour Vague 1
}

/**
 * Résultat de la Phase 2
 */
export interface GenerateWithToolResultsResult {
  content: string;
}
