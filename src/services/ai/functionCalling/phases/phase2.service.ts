/**
 * Phase 2 : Génération de la réponse finale avec les résultats des tools
 *
 * Ce service prend les résultats des tools exécutés en Phase 1 et génère
 * une réponse finale structurée et précise pour l'utilisateur.
 */

import { AIService } from '../../base.js';
import { buildWikipediaLicenseFooter } from '../utils/wikipediaExtractor.js';
import type {
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult
} from '../types/phase2.types.js';

/**
 * Service pour la Phase 2 : Génération de la réponse finale
 */
export class Phase2Service {
  /**
   * 🔥 PHASE 2: Génère réponse finale avec résultats des tools
   */
  static async generateWithToolResults(
    options: GenerateWithToolResultsOptions
  ): Promise<GenerateWithToolResultsResult> {
    const { query, toolResults, systemPrompt, onStream, wikipediaSources } = options;

    console.log(`🔧 [PHASE-2] Génération réponse finale`);

    const phase2SystemPrompt = `${systemPrompt}

Les outils ont déjà été utilisés pour collecter des informations. Tu dois maintenant générer une réponse COMPLÈTE et DÉTAILLÉE.

📝 OBJECTIF EN MODE RECHERCHE :
- Fournis une réponse APPROFONDIE qui exploite TOUTES les sources disponibles
- Ne te contente PAS d'un résumé superficiel
- Développe les concepts, donne des exemples concrets, explique les applications
- Structure ta réponse avec des sections claires (titres, sous-titres)
- Cite les sources lorsque pertinent

🎯 STRUCTURE RECOMMANDÉE :
1. **Introduction** : Contexte et vue d'ensemble du sujet
2. **Développement** : Explication détaillée avec sous-sections
   - Définitions et concepts clés
   - Propriétés et caractéristiques importantes
   - Applications pratiques et exemples
   - Cas d'usage ou contexte historique si pertinent
3. **Conclusion** : Synthèse et points à retenir

📊 QUALITÉ ATTENDUE :
- Minimum 300-500 mots pour une réponse complète
- Utilise des listes à puces, tableaux, ou exemples pour clarifier
- Évite les réponses vagues ou trop courtes
- Si plusieurs sources ont été consultées, intègre leurs informations de manière cohérente

⚠️ IMPORTANT :
- N'invente RIEN : utilise UNIQUEMENT les informations des résultats des outils
- Si une information est incomplète, indique-le clairement
- Reste factuel et précis dans tes explications`;

    const phase2Prompt = `${toolResults}

Question de l'utilisateur: ${query}

🎯 GÉNÈRE MAINTENANT UNE RÉPONSE COMPLÈTE ET APPROFONDIE en suivant la structure recommandée ci-dessus.
Utilise TOUS les résultats des outils pour créer une réponse riche en informations.`;

    let fullContent = '';

    await AIService.generateContent({
      prompt: phase2Prompt,
      context: phase2SystemPrompt,
      temperature: 0.3, // 🔥 Légèrement plus créatif pour des réponses plus riches
      maxTokens: 6000, // 🔥 Augmenté pour permettre des réponses détaillées (300-500 mots minimum)
      onStream: (chunk: string) => {
        fullContent += chunk;
        if (onStream) {
          onStream(chunk);
        }
      }
    });

    // 📚 Ajouter le footer de licence Wikipedia si des sources sont présentes
    if (wikipediaSources && wikipediaSources.length > 0) {
      const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);

      if (licenseFooter) {
        console.log(`📚 [PHASE-2] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`);

        // Streamer le footer si un callback est fourni
        if (onStream) {
          onStream(licenseFooter);
        }

        fullContent += licenseFooter;
      }
    }

    console.log(`✅ [PHASE-2] Réponse générée: ${fullContent.length} chars`);

    return { content: fullContent };
  }
}
