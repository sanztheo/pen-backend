/**
 * Phase 2 : Génération de la réponse finale avec les résultats des tools
 *
 * Ce service prend les résultats des tools exécutés en Phase 1 et génère
 * une réponse finale structurée et précise pour l'utilisateur.
 */

import { AIService } from "../../base.js";
import { buildWikipediaLicenseFooter } from "../utils/wikipediaExtractor.js";
import type {
  GenerateWithToolResultsOptions,
  GenerateWithToolResultsResult,
} from "../types/phase2.types.js";

/**
 * Service pour la Phase 2 : Génération de la réponse finale
 */
export class Phase2Service {
  /**
   * 🔥 PHASE 2: Génère réponse finale avec résultats des tools
   */
  static async generateWithToolResults(
    options: GenerateWithToolResultsOptions,
  ): Promise<GenerateWithToolResultsResult> {
    const {
      query,
      toolResults,
      systemPrompt,
      onStream,
      wikipediaSources,
      conversationHistory,
    } = options;

    console.log(`🔧 [PHASE-2] Génération réponse finale`);

    // 🎯 DÉTECTION D'INTENTION : Analyser la query pour adapter la génération
    const intentKeywords = {
      create: [
        "crée",
        "créer",
        "génère",
        "générer",
        "écris",
        "écrire",
        "rédige",
        "rédiger",
        "compose",
        "construis",
        "fais",
        "faire",
      ],
      explain: [
        "explique",
        "expliquer",
        "comment",
        "pourquoi",
        "qu'est-ce",
        "c'est quoi",
      ],
      list: [
        "liste",
        "lister",
        "énumère",
        "énumérer",
        "quels sont",
        "quelles sont",
      ],
    };

    const queryLower = query.toLowerCase();
    let detectedIntent = "explain"; // Par défaut : explication

    if (intentKeywords.create.some((kw) => queryLower.includes(kw))) {
      detectedIntent = "create";
      console.log(`🎨 [PHASE-2] Intention détectée: CREATE`);
    } else if (intentKeywords.list.some((kw) => queryLower.includes(kw))) {
      detectedIntent = "list";
      console.log(`📋 [PHASE-2] Intention détectée: LIST`);
    } else {
      console.log(`📖 [PHASE-2] Intention détectée: EXPLAIN (défaut)`);
    }

    // 🎯 SYSTÈME PROMPT ADAPTATIF selon l'intention
    let intentSpecificInstructions = "";

    if (detectedIntent === "create") {
      intentSpecificInstructions = `
Tu es en train de CRÉER du contenu original basé sur la demande de l'utilisateur.

RÈGLES POUR LA CRÉATION :
- La demande utilisateur définit CE QUE tu dois créer (page de bienvenue, email, article, etc.)
- Les résultats des outils servent à ENRICHIR ton contenu avec des informations pertinentes
- Adopte le ton et le format appropriés à ce qui est demandé
- Commence DIRECTEMENT par le contenu créé, sans titre ni introduction méta
- Personnalise avec le contexte fourni par l'utilisateur
- Crée même si les informations sont limitées, utilise ce qui est disponible intelligemment

EXEMPLES :
- "crée une page de bienvenue" → Commence directement avec un message accueillant
- "écris un email" → Commence par l'objet ou le corps de l'email
- "rédige un article" → Commence directement avec le premier paragraphe`;
    } else if (detectedIntent === "list") {
      intentSpecificInstructions = `
L'utilisateur veut une énumération claire.

RÈGLES POUR LES LISTES :
- Commence directement par les éléments de la liste
- Utilise des puces ou numéros selon le contexte
- Sois concis et précis sur chaque élément
- Groupe par catégories si cela améliore la clarté`;
    } else {
      // Mode explain (défaut)
      intentSpecificInstructions = `
L'utilisateur cherche à comprendre un concept ou un sujet.

RÈGLES POUR LES EXPLICATIONS :
- Commence directement par l'explication, sans titre introductif
- Fournis une explication approfondie qui exploite toutes les sources disponibles
- Développe les concepts avec des exemples concrets
- Utilise des sections (##) uniquement si nécessaire pour organiser une réponse longue
- Structure naturellement : introduction → développement → synthèse`;
    }

    const phase2SystemPrompt = `${systemPrompt}

Tu es un assistant IA qui génère des réponses claires, précises et bien structurées.

Les outils ont collecté des informations. Génère maintenant une réponse complète basée sur ces informations.

${intentSpecificInstructions}

RÈGLES DE FORMATAGE :
- JAMAIS de titre au début de la réponse (pas de # ou ## en première ligne)
- Commence DIRECTEMENT par le contenu pertinent
- Utilise des sections (##) uniquement si la réponse est longue et nécessite une organisation
- Utilise des listes à puces pour énumérer des éléments
- Utilise du gras (**) pour mettre en valeur des points importants
- Garde un ton naturel et fluide

RÈGLES DE CONTENU :
- Base-toi UNIQUEMENT sur les informations fournies par les outils
- N'invente aucune information
- Si une information est incomplète, indique-le clairement
- Reste factuel et précis
- Réponds dans la langue de la demande utilisateur

RÈGLES DE STYLE :
- Pas de phrases d'ouverture méta comme "Voici...", "Laissez-moi vous expliquer..."
- Pas de questions rhétoriques à la fin
- Pas de formulations hésitantes ou conditionnelles excessives
- Ton professionnel mais accessible`;

    // 🆕 Construire le contexte de l'historique si disponible
    const historyContext = conversationHistory
      ? `📜 HISTORIQUE DE CONVERSATION (CONTEXTE)

Voici l'historique de votre conversation précédente avec l'utilisateur. Utilisez-le pour maintenir la continuité et répondre aux questions qui font référence à cet historique.

${conversationHistory}

---

`
      : "";

    // 🔥 CRITICAL: Historique EN PREMIER, puis Query, puis résultats
    const phase2Prompt = `${historyContext}🎯 DEMANDE ACTUELLE DE L'UTILISATEUR (C'EST LA BASE DE CE QUE TU DOIS GÉNÉRER) :
"${query}"

📊 CONTEXTE ET INFORMATIONS COLLECTÉES (pour enrichir ta réponse) :
${toolResults}

🚀 GÉNÈRE MAINTENANT LA RÉPONSE en respectant l'intention détectée (${detectedIntent.toUpperCase()}).
Rappel : La demande utilisateur est LA BASE, les tool results sont le CONTEXTE pour l'enrichir.`;

    let fullContent = "";

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
      },
    });

    // 📚 Ajouter le footer de licence Wikipedia si des sources sont présentes
    if (wikipediaSources && wikipediaSources.length > 0) {
      const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);

      if (licenseFooter) {
        console.log(
          `📚 [PHASE-2] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`,
        );

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
