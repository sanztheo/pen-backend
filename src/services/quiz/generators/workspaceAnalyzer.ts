import { AIService } from '../../ai/base.js';
import { SchoolLevel } from '../types.js';
import { JsonUtils } from '../utils/jsonUtils.js';

/**
 * Analyseur de contenu utilisateur pour la génération de quiz
 */
export class WorkspaceAnalyzer {
  /**
   * Analyse le contenu utilisateur pour la génération de quiz
   */
  static async analyzeWorkspaceContent(
    workspaceContent: string,
    workspaceName: string,
    schoolLevel: SchoolLevel
  ): Promise<{
    mainTopics: string[];
    complexity: 'basique' | 'intermédiaire' | 'avancé';
    suggestedQuestionCount: number;
    relevanceScore: number;
  }> {
    try {
      const prompt = `
Analyse ce contenu utilisateur pour la génération de quiz de niveau ${schoolLevel}.

CONTENU À ANALYSER :
Source: ${workspaceName}
Contenu:
${workspaceContent.substring(0, 2000)} // Limite pour éviter les tokens excessifs

INSTRUCTIONS :
1. Identifie les 5 sujets principaux abordés
2. Évalue la complexité du contenu (basique/intermédiaire/avancé)
3. Suggère un nombre de questions approprié (5-50)
4. Évalue la pertinence pour créer un quiz (0-100)

IMPORTANT : Réponds UNIQUEMENT en JSON valide, sans texte explicatif :
{
  "mainTopics": ["sujet1", "sujet2", "sujet3", "sujet4", "sujet5"],
  "complexity": "basique|intermédiaire|avancé",
  "suggestedQuestionCount": nombre,
  "relevanceScore": score_sur_100
}
`;

      const result = await AIService.generateContent({
        prompt,
        maxTokens: 2000,
        temperature: 0.5,
        model: AIService.getDefaultModel()
      });

      try {
        return JSON.parse(result.content);
      } catch (error) {
        try {
          // Tenter d'extraire le JSON du contenu
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          } else {
            throw error;
          }
        } catch (secondError) {
          console.error('❌ Erreur parsing analyse workspace:', result.content.substring(0, 300));
          throw error;
        }
      }

    } catch (error) {
      console.error('Erreur analyse workspace IA:', error);
      // Retour par défaut en cas d'erreur
      return {
        mainTopics: ['Contenu général'],
        complexity: 'intermédiaire',
        suggestedQuestionCount: 10,
        relevanceScore: 50
      };
    }
  }
} 