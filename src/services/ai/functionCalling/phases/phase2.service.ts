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

Les outils ont déjà été utilisés pour répondre à la question. Leurs résultats sont fournis ci-dessous. Utilise ces résultats pour répondre à la question de l'utilisateur de manière claire, structurée et précise.`;

    const phase2Prompt = `${toolResults}

Question de l'utilisateur: ${query}

Réponds maintenant à la question en utilisant les résultats des outils ci-dessus.`;

    let fullContent = '';

    await AIService.generateContent({
      prompt: phase2Prompt,
      context: phase2SystemPrompt,
      temperature: 0.2,
      maxTokens: 4000,
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
