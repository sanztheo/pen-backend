/**
 * Utilitaire pour construire le contexte à partir des résultats des tools
 */

import { ToolCallRecord } from '../types/common.types.js';

/**
 * 🔥 Helper: Construit le contexte pour Phase 2 à partir des résultats des tools
 */
export const buildContextFromToolResults = (toolCalls: ToolCallRecord[]): string => {
  if (toolCalls.length === 0) {
    return '';
  }

  let context = '📚 Résultats des outils utilisés:\n\n';

  toolCalls.forEach((tc, i) => {
    context += `### Outil ${i + 1}: ${tc.name}\n`;
    context += `**Arguments**: ${JSON.stringify(tc.arguments, null, 2)}\n\n`;
    context += `**Résultat**:\n${tc.result}\n\n`;
    context += '---\n\n';
  });

  return context;
};
