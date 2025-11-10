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
    const { query, toolResults, systemPrompt, onStream, wikipediaSources } =
      options;

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
🎨 MODE CRÉATION ACTIVÉ
Tu es en train de CRÉER du contenu original basé sur la demande de l'utilisateur.

🚨 RÈGLE D'OR : LA QUERY UTILISATEUR EST LA BASE
La demande de l'utilisateur définit CE QUE tu dois créer. Les tool results sont là pour ENRICHIR ton contenu, PAS pour le remplacer.

📝 INSTRUCTIONS SPÉCIFIQUES POUR MODE CREATE :
1. **Respecte l'intention de création** : Si l'user demande "crée une page de bienvenue", tu crées UNE PAGE DE BIENVENUE, pas une description
2. **Utilise les tool results comme contexte** : Les infos récoltées servent à personnaliser/enrichir ta création
3. **Sois créatif et engageant** : Adapte le ton et le style à ce qui est demandé (page web, email, article, etc.)
4. **Structure selon le format demandé** : Page de bienvenue ≠ article descriptif ≠ tutorial
5. **Personnalise pour le contexte** : Si l'user mentionne "mon saas", intègre ce contexte dans ta création

🔥 GESTION DES TOOL RESULTS LIMITÉS :
→ Si tool results contiennent peu d'info : CRÉE QUAND MÊME avec les infos disponibles (ne dis JAMAIS "je ne peux pas")
→ Si tool results manquent de contexte : Intègre ce que tu as trouvé dans une création appropriée
→ Exemple : Tool result = "Y Combinator is a startup accelerator" → Création = "Welcome to [SaaS Name]! As participants in Y Combinator, the world-renowned startup accelerator..."

🎯 EXEMPLES DE CRÉATION :
- "crée une page de bienvenue pour X" → Page web accueillante, chaleureuse, avec CTA
- "écris un email à Y" → Format email avec objet, corps, signature
- "rédige un article sur Z" → Article structuré avec intro, développement, conclusion

⚠️ CE QU'IL NE FAUT PAS FAIRE :
❌ User demande "page de bienvenue" → Tu génères une page descriptive/éducative
❌ User demande "email" → Tu génères un article
❌ Ignorer le contexte mentionné par l'user (ex: "mon saas", "ma startup")
❌ Dire "je ne peux pas créer" quand les tool results sont limités

✅ CE QU'IL FAUT FAIRE :
✅ User demande "page de bienvenue" → Tu génères une vraie page de bienvenue chaleureuse
✅ Utiliser les infos des tools pour ENRICHIR, pas pour REMPLACER l'intention
✅ Adapter le ton/style au format demandé
✅ TOUJOURS créer même si tool results sont incomplets/génériques`;
    } else if (detectedIntent === "list") {
      intentSpecificInstructions = `
📋 MODE LISTE ACTIVÉ
L'utilisateur veut une énumération claire et structurée.

📝 INSTRUCTIONS :
- Présente les éléments sous forme de liste à puces ou numérotée
- Sois concis sur chaque élément
- Groupe par catégories si pertinent
- Utilise les tool results pour être exhaustif`;
    } else {
      // Mode explain (défaut)
      intentSpecificInstructions = `
📖 MODE EXPLICATION ACTIVÉ
L'utilisateur cherche à comprendre un concept ou un sujet.

📝 INSTRUCTIONS :
- Fournis une explication APPROFONDIE qui exploite TOUTES les sources disponibles
- Développe les concepts, donne des exemples concrets, explique les applications
- Structure ta réponse avec des sections claires (titres, sous-titres)

🎯 STRUCTURE RECOMMANDÉE :
1. **Introduction** : Contexte et vue d'ensemble
2. **Développement** : Explication détaillée avec sous-sections
   - Définitions et concepts clés
   - Propriétés et caractéristiques importantes
   - Applications pratiques et exemples
3. **Conclusion** : Synthèse et points à retenir

📊 QUALITÉ ATTENDUE :
- Minimum 300-500 mots pour une réponse complète
- Utilise des listes à puces, tableaux, ou exemples pour clarifier`;
    }

    const phase2SystemPrompt = `${systemPrompt}

Les outils ont déjà été utilisés pour collecter des informations. Tu dois maintenant générer une réponse COMPLÈTE et DÉTAILLÉE.

${intentSpecificInstructions}

⚠️ RÈGLES UNIVERSELLES :
- N'invente RIEN : utilise UNIQUEMENT les informations des résultats des outils
- Si une information est incomplète, indique-le clairement
- Reste factuel et précis dans tes explications
- La QUERY UTILISATEUR définit ce que tu dois produire, les tool results sont le CONTEXTE`;

    // 🔥 CRITICAL: Query EN PREMIER pour que l'IA comprenne l'objectif AVANT de voir les résultats
    const phase2Prompt = `🎯 DEMANDE DE L'UTILISATEUR (C'EST LA BASE DE CE QUE TU DOIS GÉNÉRER) :
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
