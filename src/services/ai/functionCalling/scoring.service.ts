/**
 * 🎯 SCORING SERVICE
 *
 * Inspiré de l'architecture Cursor :
 * - Score chaque résultat de tool (0.0 à 1.0)
 * - Feedback loop : observe → adjust → continue
 * - Décisions adaptatives basées sur la qualité des résultats
 */

import { AIService } from "../base.js";

export interface ToolResultScore {
  confidence: number; // 0.0-1.0 : qualité du résultat
  relevance: number; // 0.0-1.0 : pertinence pour la query
  completeness: number; // 0.0-1.0 : information suffisante ?
  overallScore: number; // moyenne pondérée (confidence*0.4 + relevance*0.3 + completeness*0.3)
  reasoning: string; // explication du score
  suggestions: string[]; // suggestions d'amélioration
}

export interface ScoreToolResultInput {
  toolName: string;
  result: string;
  query: string;
  expectedInfo?: string;
  context?: {
    previousScores?: ToolResultScore[];
    useWeb?: boolean;
    hasSpecificSource?: boolean;
    mode?: "ask" | "search";
  };
}

export interface StrategyAdjustment {
  shouldExploreMore: boolean; // Explorer d'autres sources ?
  shouldUseWeb: boolean; // Utiliser search_web ?
  shouldStop: boolean; // Arrêter, info suffisante ?
  confidence: number; // 0-1 : confiance dans la stratégie
  reasoning: string; // pourquoi cet ajustement
  suggestedTools: string[]; // tools recommandés
  priority: "low" | "medium" | "high" | "critical";
}

export class ScoringService {
  /**
   * 🎯 Score un résultat de tool (0.0 à 1.0)
   */
  static async scoreToolResult(
    input: ScoreToolResultInput,
  ): Promise<ToolResultScore> {
    const { toolName, result, query, expectedInfo, context } = input;

    console.log(`📊 [SCORING] Évaluation du résultat de ${toolName}...`);

    // 🔥 RÈGLES HEURISTIQUES RAPIDES (pas d'IA pour économiser les crédits)
    const heuristicScore = this.calculateHeuristicScore(
      toolName,
      result,
      query,
    );

    // Si le score heuristique est très clair (>0.8 ou <0.3), pas besoin d'IA
    if (
      heuristicScore.overallScore > 0.8 ||
      heuristicScore.overallScore < 0.3
    ) {
      console.log(
        `📊 [SCORING] Score heuristique clair: ${heuristicScore.overallScore.toFixed(2)}`,
      );
      return heuristicScore;
    }

    // 🤖 Pour les cas ambigus, utiliser l'IA (GPT-4o-mini pour économiser)
    try {
      const openai = AIService.getOpenAI();

      const scoringPrompt = `Tu es un évaluateur de qualité de résultats d'outils IA.

OUTIL EXÉCUTÉ : ${toolName}
QUESTION : "${query}"
${expectedInfo ? `INFORMATION ATTENDUE : ${expectedInfo}` : ""}

RÉSULTAT DE L'OUTIL :
${result.slice(0, 1000)} ${result.length > 1000 ? "... (tronqué)" : ""}

CONTEXTE :
${context?.hasSpecificSource ? "- Une source spécifique a été sélectionnée par l'utilisateur" : "- Mode exploration libre"}
${context?.useWeb ? "- Recherche web activée" : "- Recherche web désactivée"}
${context?.previousScores ? `- Scores précédents: ${context.previousScores.map((s) => s.overallScore.toFixed(2)).join(", ")}` : ""}

ÉVALUE CE RÉSULTAT SUR 3 DIMENSIONS (0.0 à 1.0) :

1. **Confidence** (qualité du résultat) :
   - 0.0-0.3 : Erreur, vide, ou inutilisable
   - 0.4-0.6 : Partiel, incomplet, mais utilisable
   - 0.7-1.0 : Complet, précis, de haute qualité

2. **Relevance** (pertinence pour la question) :
   - 0.0-0.3 : Hors-sujet, non pertinent
   - 0.4-0.6 : Partiellement pertinent
   - 0.7-1.0 : Très pertinent, répond directement

3. **Completeness** (suffisant pour répondre ?) :
   - 0.0-0.3 : Insuffisant, beaucoup d'informations manquantes
   - 0.4-0.6 : Partiellement suffisant, pourrait être enrichi
   - 0.7-1.0 : Suffisant, répond pleinement à la question

RETOURNE UNIQUEMENT UN JSON STRICT :
{
  "confidence": <0.0-1.0>,
  "relevance": <0.0-1.0>,
  "completeness": <0.0-1.0>,
  "reasoning": "<explication courte en 1-2 phrases>",
  "suggestions": ["<suggestion 1>", "<suggestion 2>"]
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu es un évaluateur expert. Tu retournes UNIQUEMENT du JSON valide.",
          },
          {
            role: "user",
            content: scoringPrompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 250,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      const score: ToolResultScore = {
        confidence: parsed.confidence || 0.5,
        relevance: parsed.relevance || 0.5,
        completeness: parsed.completeness || 0.5,
        overallScore:
          (parsed.confidence || 0.5) * 0.4 +
          (parsed.relevance || 0.5) * 0.3 +
          (parsed.completeness || 0.5) * 0.3,
        reasoning: parsed.reasoning || "Score calculé par IA",
        suggestions: parsed.suggestions || [],
      };

      console.log(
        `📊 [SCORING] Score IA calculé: ${score.overallScore.toFixed(2)}`,
      );
      return score;
    } catch (error) {
      console.warn(
        `⚠️ [SCORING] Erreur lors du scoring IA, fallback heuristique:`,
        error,
      );
      return heuristicScore;
    }
  }

  /**
   * 🎯 Calcul de score heuristique (rapide, sans IA)
   */
  private static calculateHeuristicScore(
    toolName: string,
    result: string,
    query: string,
  ): ToolResultScore {
    let confidence = 0.5;
    let relevance = 0.5;
    let completeness = 0.5;
    const suggestions: string[] = [];

    // RÈGLE 1 : Détecter les erreurs évidentes
    if (
      result.startsWith("❌") ||
      result.includes("Erreur") ||
      result.includes("Error")
    ) {
      confidence = 0.1;
      relevance = 0.1;
      completeness = 0.1;
      suggestions.push("Résultat en erreur, essayer un autre outil");
    }
    // RÈGLE 2 : Détecter les résultats vides
    else if (
      result.includes("Aucune source") ||
      result.includes("Aucun résultat") ||
      result.length < 50
    ) {
      confidence = 0.2;
      relevance = 0.3;
      completeness = 0.2;
      suggestions.push(
        "Résultat vide ou insuffisant, explorer d'autres sources",
      );
    }
    // RÈGLE 3 : Résultats avec contenu
    else if (result.length > 200) {
      confidence = 0.7;
      relevance = 0.6;
      completeness = 0.6;

      // Bonus si le résultat contient des mots-clés de la query
      const queryWords = query
        .toLowerCase()
        .split(" ")
        .filter((w) => w.length > 3);
      const matchCount = queryWords.filter((word) =>
        result.toLowerCase().includes(word),
      ).length;
      const matchRatio =
        queryWords.length > 0 ? matchCount / queryWords.length : 0;

      relevance = Math.min(1.0, 0.5 + matchRatio * 0.5);

      if (result.length > 1000) {
        completeness = 0.8;
        confidence = 0.8;
      }
    }

    // RÈGLE 4 : Ajustements par type de tool
    if (
      toolName === "list_available_sources" ||
      toolName === "list_global_wikipedia_sources"
    ) {
      // Pour les listings, on compte le nombre de sources
      const sourceCount = (result.match(/\d+\.\s*\[/g) || []).length;
      if (sourceCount > 0) {
        confidence = 0.9;
        completeness = sourceCount > 5 ? 0.9 : 0.7;
        suggestions.push(
          `${sourceCount} sources trouvées, procéder à la sélection`,
        );
      }
    }

    if (toolName === "search_web") {
      // Pour le web, vérifier si des résultats ont été trouvés
      if (result.includes("Résultat") || result.includes("Source")) {
        confidence = 0.8;
        completeness = 0.7;
      }
    }

    const overallScore =
      confidence * 0.4 + relevance * 0.3 + completeness * 0.3;

    return {
      confidence,
      relevance,
      completeness,
      overallScore,
      reasoning: `Score heuristique: confiance=${confidence.toFixed(2)}, pertinence=${relevance.toFixed(2)}, complétude=${completeness.toFixed(2)}`,
      suggestions,
    };
  }

  /**
   * 🔄 FEEDBACK LOOP : Ajuste la stratégie en fonction des scores
   *
   * Inspiré de Cursor : "observe → adjust → continue"
   */
  static async adjustStrategy(
    executedTools: Array<{
      name: string;
      score?: ToolResultScore;
      result: string;
    }>,
    query: string,
    context: {
      useWeb: boolean;
      availableSourcesCount: number;
      hasSpecificSource: boolean;
      mode: "ask" | "search";
    },
  ): Promise<StrategyAdjustment> {
    console.log(
      `🔄 [STRATEGY-ADJUST] Analyse de ${executedTools.length} tools exécutés...`,
    );

    // Calculer le score moyen
    const scores = executedTools.map((t) => t.score?.overallScore || 0.5);
    const avgScore =
      scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);

    // 🔥 FIX: Détecter le mode Web Only (useWeb=true ET aucune source spécifique)
    const isWebOnlyMode = context.useWeb && !context.hasSpecificSource;

    console.log(
      `📊 [STRATEGY-ADJUST] Score moyen: ${avgScore.toFixed(2)} | Mode: ${isWebOnlyMode ? "WEB-ONLY" : "HYBRID"}`,
    );

    // 🎯 SCÉNARIO 0 : MODE WEB ONLY - Ne JAMAIS suggérer de tools locaux
    if (isWebOnlyMode) {
      const hasSearchedWeb = executedTools.some((t) => t.name === "search_web");
      const webSearchCount = executedTools.filter(
        (t) => t.name === "search_web",
      ).length;

      if (!hasSearchedWeb) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: true,
          shouldStop: false,
          confidence: 0.95,
          reasoning: "Mode Web Only : recherche web requise.",
          suggestedTools: ["search_web"],
          priority: "critical",
        };
      }

      if (avgScore < 0.6 && webSearchCount < 3) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: true,
          shouldStop: false,
          confidence: 0.85,
          reasoning: `Mode Web Only : résultats insuffisants (${avgScore.toFixed(2)}), recherche supplémentaire recommandée.`,
          suggestedTools: ["search_web"],
          priority: "high",
        };
      }

      if (avgScore >= 0.6) {
        return {
          shouldExploreMore: false,
          shouldUseWeb: false,
          shouldStop: true,
          confidence: 0.9,
          reasoning: `Mode Web Only : informations web suffisantes (${avgScore.toFixed(2)}).`,
          suggestedTools: [],
          priority: "low",
        };
      }

      // Fallback Web Only : trop de recherches
      return {
        shouldExploreMore: false,
        shouldUseWeb: false,
        shouldStop: true,
        confidence: 0.7,
        reasoning: `Mode Web Only : limite de recherches atteinte (${webSearchCount} recherches).`,
        suggestedTools: [],
        priority: "low",
      };
    }

    // 🎯 SCÉNARIO 1 : Page/source unique spécifique
    if (context.hasSpecificSource && context.availableSourcesCount === 1) {
      const lastScore = scores[scores.length - 1] || 0.5;

      if (lastScore > 0.7) {
        // Score élevé sur la page → suggérer d'arrêter (mais permettre web si activé)
        return {
          shouldExploreMore: false,
          shouldUseWeb:
            context.useWeb &&
            !executedTools.some((t) => t.name === "search_web"),
          shouldStop: !context.useWeb,
          confidence: 0.9,
          reasoning:
            "La page sélectionnée contient des informations de qualité. " +
            (context.useWeb
              ? "Web disponible pour enrichissement optionnel."
              : "Information suffisante."),
          suggestedTools: context.useWeb ? ["search_web"] : [],
          priority: context.useWeb ? "low" : "low",
        };
      } else if (lastScore > 0.4) {
        // Score moyen → suggérer exploration modérée
        return {
          shouldExploreMore: true,
          shouldUseWeb: context.useWeb,
          shouldStop: false,
          confidence: 0.7,
          reasoning:
            "La page sélectionnée contient des informations partielles. Exploration recommandée.",
          suggestedTools: context.useWeb
            ? ["search_web"]
            : ["list_available_sources"],
          priority: "medium",
        };
      } else {
        // Score faible → fortement recommander exploration
        return {
          shouldExploreMore: true,
          shouldUseWeb: context.useWeb,
          shouldStop: false,
          confidence: 0.9,
          reasoning:
            "La page sélectionnée est insuffisante. Exploration d'autres sources fortement recommandée.",
          suggestedTools: context.useWeb
            ? ["search_web", "list_available_sources"]
            : ["list_available_sources"],
          priority: "high",
        };
      }
    }

    // 🎯 SCÉNARIO 2 : Multiple sources sélectionnées
    if (context.hasSpecificSource && context.availableSourcesCount > 1) {
      if (avgScore > 0.7) {
        return {
          shouldExploreMore: false,
          shouldUseWeb:
            context.useWeb &&
            !executedTools.some((t) => t.name === "search_web"),
          shouldStop: !context.useWeb,
          confidence: 0.85,
          reasoning:
            "Les sources sélectionnées fournissent des informations complètes.",
          suggestedTools: context.useWeb ? ["search_web"] : [],
          priority: "low",
        };
      } else {
        return {
          shouldExploreMore: true,
          shouldUseWeb: context.useWeb,
          shouldStop: false,
          confidence: 0.8,
          reasoning:
            "Les sources sélectionnées sont partielles. Exploration recommandée.",
          suggestedTools: context.useWeb
            ? ["search_web"]
            : ["list_available_sources"],
          priority: "medium",
        };
      }
    }

    // 🎯 SCÉNARIO 3 : all_source (exploration libre)
    if (!context.hasSpecificSource || context.availableSourcesCount === 0) {
      const hasListedSources = executedTools.some(
        (t) =>
          t.name === "list_available_sources" ||
          t.name === "list_global_wikipedia_sources",
      );
      const hasReadSources = executedTools.some(
        (t) =>
          t.name === "read_rag_source" || t.name === "select_relevant_sources",
      );
      const hasSearchedWeb = executedTools.some((t) => t.name === "search_web");

      // Si aucune source listée encore
      if (!hasListedSources) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: false,
          shouldStop: false,
          confidence: 0.95,
          reasoning:
            "Mode exploration : lister d'abord les sources disponibles.",
          suggestedTools: [
            "list_available_sources",
            "list_global_wikipedia_sources",
          ],
          priority: "critical",
        };
      }

      // Si sources listées mais pas encore lues
      if (hasListedSources && !hasReadSources) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: false,
          shouldStop: false,
          confidence: 0.9,
          reasoning:
            "Sources listées : sélectionner et lire les plus pertinentes.",
          suggestedTools: ["select_relevant_sources", "read_rag_source"],
          priority: "high",
        };
      }

      // Si sources lues, évaluer la qualité
      if (avgScore > 0.7) {
        return {
          shouldExploreMore: false,
          shouldUseWeb: context.useWeb && !hasSearchedWeb,
          shouldStop: !context.useWeb || hasSearchedWeb,
          confidence: 0.85,
          reasoning:
            "Sources locales de qualité trouvées. " +
            (context.useWeb && !hasSearchedWeb
              ? "Web disponible pour enrichissement."
              : "Information suffisante."),
          suggestedTools:
            context.useWeb && !hasSearchedWeb ? ["search_web"] : [],
          priority: context.useWeb && !hasSearchedWeb ? "medium" : "low",
        };
      } else {
        return {
          shouldExploreMore: true,
          shouldUseWeb: context.useWeb,
          shouldStop: false,
          confidence: 0.8,
          reasoning:
            "Sources locales insuffisantes. " +
            (context.useWeb
              ? "Recherche web recommandée."
              : "Explorer d'autres sources."),
          suggestedTools: context.useWeb
            ? ["search_web"]
            : ["search_rag_chunks"],
          priority: "high",
        };
      }
    }

    // 🎯 SCÉNARIO 4 : useWeb activé mais pas encore utilisé
    if (context.useWeb && !executedTools.some((t) => t.name === "search_web")) {
      if (avgScore < 0.6) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: true,
          shouldStop: false,
          confidence: 0.9,
          reasoning:
            "Résultats actuels insuffisants. Recherche web fortement recommandée.",
          suggestedTools: ["search_web"],
          priority: "critical",
        };
      } else if (avgScore < 0.8) {
        return {
          shouldExploreMore: true,
          shouldUseWeb: true,
          shouldStop: false,
          confidence: 0.7,
          reasoning:
            "Résultats partiels. Recherche web recommandée pour enrichir.",
          suggestedTools: ["search_web"],
          priority: "medium",
        };
      } else {
        return {
          shouldExploreMore: false,
          shouldUseWeb: true,
          shouldStop: false,
          confidence: 0.6,
          reasoning:
            "Résultats de qualité. Recherche web optionnelle pour enrichissement.",
          suggestedTools: ["search_web"],
          priority: "low",
        };
      }
    }

    // 🎯 FALLBACK : Cas par défaut
    return {
      shouldExploreMore: avgScore < 0.7,
      shouldUseWeb: context.useWeb && avgScore < 0.6,
      shouldStop: avgScore > 0.7,
      confidence: 0.5,
      reasoning: `Score moyen ${avgScore.toFixed(2)}. Stratégie standard.`,
      suggestedTools: [],
      priority: "medium",
    };
  }

  /**
   * 📊 Calcule les statistiques globales des scores
   */
  static calculateScoreStats(scores: ToolResultScore[]): {
    average: number;
    min: number;
    max: number;
    trend: "improving" | "declining" | "stable";
  } {
    if (scores.length === 0) {
      return { average: 0, min: 0, max: 0, trend: "stable" };
    }

    const overallScores = scores.map((s) => s.overallScore);
    const average =
      overallScores.reduce((a, b) => a + b, 0) / overallScores.length;
    const min = Math.min(...overallScores);
    const max = Math.max(...overallScores);

    // Détecter la tendance (comparer première moitié vs deuxième moitié)
    let trend: "improving" | "declining" | "stable" = "stable";
    if (scores.length >= 4) {
      const midPoint = Math.floor(scores.length / 2);
      const firstHalf = overallScores.slice(0, midPoint);
      const secondHalf = overallScores.slice(midPoint);
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      if (secondAvg > firstAvg + 0.1) trend = "improving";
      else if (secondAvg < firstAvg - 0.1) trend = "declining";
    }

    return { average, min, max, trend };
  }
}
