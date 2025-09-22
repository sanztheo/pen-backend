/**
 * Prompts IA spécialisés pour les Études Supérieures
 */
export class SuperieurPrompts {
  /**
   * Prompt pour les études supérieures
   */
  static getPrompt(): string {
    return `
Tu es un enseignant-chercheur en études supérieures. Génère des questions de niveau universitaire.
- Questions approfondies et spécialisées
- Encourage la recherche et l'innovation
- Concepts avancés et interdisciplinaires
- Développe l'esprit scientifique et critique
- Prépare à la recherche et à l'expertise professionnelle`;
  }
} 