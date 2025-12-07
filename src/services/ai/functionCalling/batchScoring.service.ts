/**
 * 🚀 BATCH SCORING SERVICE
 *
 * Optimisation majeure : Score TOUS les résultats en UN SEUL appel API
 * au lieu de 10 appels parallèles.
 *
 * Gain : ~7s (10 parallèles) → ~2-3s (1 batch)
 */

import { AIService } from "../base.js";
import type { ToolResultScore } from "./scoring.service.js";

export interface BatchScoreInput {
  tool: string;
  result: string;
  description?: string;
}

export interface BatchScoreOptions {
  query: string;
  results: BatchScoreInput[];
  model?: string;
  mode?: "ask" | "search";
}

export class BatchScoringService {
  /**
   * 🚀 Score TOUS les résultats en UN SEUL appel API
   *
   * @param options - Options de scoring batch
   * @returns Tableau de scores pour chaque résultat
   */
  static async batchScore(options: BatchScoreOptions): Promise<ToolResultScore[]> {
    const { query, results, model, mode } = options;

    // Si aucun résultat, retourner vide
    if (results.length === 0) {
      return [];
    }

    console.log(`📊 [BATCH-SCORING] Scoring de ${results.length} résultats en 1 appel...`);
    const startTime = Date.now();

    try {
      // 🧠 SÉLECTION DU CLIENT (OpenAI vs Grok)
      let client: any;
      const modelToUse = model || "gpt-4o-mini";
      const isGrok = typeof modelToUse === "string" && modelToUse.toLowerCase().includes("grok");

      if (isGrok) {
        console.log("📊 [BATCH-SCORING] Utilisation de xAI (Grok)");
        client = AIService.getGrok();
      } else {
        client = AIService.getOpenAI();
      }

      // 🔥 PROMPT BATCH : Tous les résultats en une seule requête
      const batchPrompt = this.buildBatchPrompt(query, results, mode);

      const response = await client.chat.completions.create({
        model: modelToUse,
        messages: [
          {
            role: "system",
            content: "Tu es un évaluateur expert de résultats d'outils IA. Retourne UNIQUEMENT du JSON valide.",
          },
          {
            role: "user",
            content: batchPrompt,
          },
        ],
        temperature: 0.1,
        max_completion_tokens: 1500, // Plus de tokens pour le batch
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      const duration = Date.now() - startTime;
      console.log(`✅ [BATCH-SCORING] Batch terminé en ${duration}ms`);

      // Transformer les scores bruts en ToolResultScore[]
      return this.parseScores(parsed, results);
    } catch (error) {
      console.warn(`⚠️ [BATCH-SCORING] Erreur, fallback scores neutres:`, error);
      // Fallback : retourner des scores neutres
      return results.map((r) => ({
        confidence: 0.5,
        relevance: 0.5,
        completeness: 0.5,
        overallScore: 0.5,
        reasoning: `Fallback score pour ${r.tool}`,
        suggestions: [],
      }));
    }
  }

  /**
   * Construit le prompt batch optimisé
   */
  private static buildBatchPrompt(
    query: string,
    results: BatchScoreInput[],
    mode?: "ask" | "search"
  ): string {
    const resultsText = results
      .map(
        (r, i) => `
[RÉSULTAT ${i + 1}]
Tool: ${r.tool}
${r.description ? `Attendu: ${r.description}` : ""}
Contenu (tronqué à 400 chars):
${r.result.slice(0, 400)}${r.result.length > 400 ? "..." : ""}
`
      )
      .join("\n---\n");

    return `ÉVALUE ces ${results.length} résultats d'outils pour la question:
"${query}"

Mode: ${mode || "search"}

${resultsText}

Pour CHAQUE résultat, donne un score de 0.0 à 1.0 sur:
- confidence: qualité du résultat (0=erreur, 1=parfait)
- relevance: pertinence pour la question (0=hors-sujet, 1=très pertinent)
- completeness: suffisant pour répondre? (0=insuffisant, 1=complet)

RETOURNE CE JSON EXACT:
{
  "scores": [
    {"confidence": 0.X, "relevance": 0.X, "completeness": 0.X, "reasoning": "..."},
    ... (un pour chaque résultat)
  ]
}`;
  }

  /**
   * Parse les scores du JSON retourné
   */
  private static parseScores(
    parsed: any,
    results: BatchScoreInput[]
  ): ToolResultScore[] {
    const scores: ToolResultScore[] = [];

    const rawScores = parsed.scores || [];

    for (let i = 0; i < results.length; i++) {
      const raw = rawScores[i] || {};

      const confidence = raw.confidence || 0.5;
      const relevance = raw.relevance || 0.5;
      const completeness = raw.completeness || 0.5;

      scores.push({
        confidence,
        relevance,
        completeness,
        overallScore: confidence * 0.4 + relevance * 0.3 + completeness * 0.3,
        reasoning: raw.reasoning || `Score batch pour ${results[i].tool}`,
        suggestions: raw.suggestions || [],
      });
    }

    return scores;
  }

  /**
   * 🔥 Détermine si on doit utiliser le batch scoring
   *
   * Règles:
   * - Si > 3 résultats à scorer → batch
   * - Si < 3 résultats → scoring individuel (plus précis)
   */
  static shouldUseBatch(resultsCount: number): boolean {
    return resultsCount > 3;
  }
}
