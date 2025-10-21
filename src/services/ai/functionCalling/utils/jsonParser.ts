/**
 * Utilitaire pour parser du JSON depuis du contenu streamé
 */

/**
 * 🔥 Helper: Parse JSON safely from streamed content
 */
export const parseJSONFromStream = (content: string): any => {
  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn('⚠️ Failed to parse JSON:', content.slice(0, 100));
    return null;
  }
};
