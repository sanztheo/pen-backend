/**
 * Utilitaire pour construire les prompts initiaux
 */

/**
 * Construit le prompt initial avec la liste des sources disponibles
 */
export const buildInitialPrompt = (
  query: string,
  sources: Array<{ id: string; title: string; type: string }>,
  useWeb: boolean,
  isSearch: boolean = false
): string => {
  let prompt = `Question de l'utilisateur: ${query}\n\n`;

  if (sources.length > 0) {
    prompt += `📚 Sources RAG disponibles (UTILISE les tools pour les lire):\n`;
    sources.forEach((s, i) => {
      prompt += `${i + 1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})\n`;
    });

    if (isSearch) {
      prompt += '\n⚠️ IMPORTANT MODE RECHERCHE APPROFONDIE:\n';
      prompt += '- Tu peux utiliser le tool read_rag_source PLUSIEURS FOIS pour lire différents passages d\'une même source\n';
      prompt += '- Cherche à comprendre le sujet en profondeur et varié\n';
      prompt += '- Tu peux consulter la tool list_available_sources pour explorer toutes les options\n\n';
    } else {
      prompt += '\n⚠️ IMPORTANT: Tu DOIS utiliser le tool read_rag_source pour lire ces sources avant de répondre.\n\n';
    }
  }

  if (useWeb) {
    prompt += '🌐 Tu peux aussi utiliser le tool search_web si nécessaire pour des informations externes ou récentes.\n\n';
  }

  prompt += isSearch
    ? 'Fais une recherche APPROFONDIE en utilisant les tools disponibles pour chercher les informations les plus complètes et détaillées, puis réponds de manière exhaustive.'
    : 'Maintenant, utilise les tools disponibles pour chercher les informations nécessaires, puis réponds à la question de manière complète et précise.';

  return prompt;
};
