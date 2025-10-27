/**
 * Utilitaire pour parser du JSON depuis du contenu streamé
 */

/**
 * 🔥 Helper: Parse JSON safely from streamed content
 * Amélioration: Extrait le JSON même s'il y a du texte avant/après ou si incomplet
 */
export const parseJSONFromStream = (content: string): any => {
  try {
    // Essai 1: Parse direct
    return JSON.parse(content);
  } catch (e) {
    // Essai 2: Extraire le JSON entre {} ou []
    try {
      // Chercher le premier { ou [
      const jsonStart = content.search(/[{\[]/);
      if (jsonStart === -1) {
        console.warn('⚠️ No JSON found in content:', content.slice(0, 100));
        return null;
      }

      // Chercher le dernier } ou ]
      const jsonEnd = content.lastIndexOf(content[jsonStart] === '{' ? '}' : ']');
      if (jsonEnd === -1) {
        console.warn('⚠️ JSON incomplete (no closing bracket):', content.slice(0, 100));
        return null;
      }

      const jsonStr = content.slice(jsonStart, jsonEnd + 1);
      return JSON.parse(jsonStr);
    } catch (e2) {
      // Essai 3: Compléter le JSON tronqué en fermant les brackets manquants
      try {
        const trimmed = content.trim();
        let completed = trimmed;

        // Compter les brackets ouverts/fermés
        const openBraces = (trimmed.match(/{/g) || []).length;
        const closeBraces = (trimmed.match(/}/g) || []).length;
        const openBrackets = (trimmed.match(/\[/g) || []).length;
        const closeBrackets = (trimmed.match(/]/g) || []).length;

        // Ajouter les brackets manquants
        const missingBrackets = openBrackets - closeBrackets;
        const missingBraces = openBraces - closeBraces;

        for (let i = 0; i < missingBrackets; i++) {
          completed += ']';
        }
        for (let i = 0; i < missingBraces; i++) {
          completed += '}';
        }

        console.log(`🔧 [JSON-PARSER] Tentative de complétion du JSON tronqué...`);
        return JSON.parse(completed);
      } catch (e3) {
        console.warn('⚠️ Failed to parse JSON after all attempts:', content.slice(0, 200));
        return null;
      }
    }
  }
};
