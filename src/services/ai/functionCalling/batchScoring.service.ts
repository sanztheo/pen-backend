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
            content: "You are an expert tool result evaluator. Return ONLY valid JSON without decorative symbols.",
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
   * Constructs the optimized batch prompt
   */
  private static buildBatchPrompt(
    query: string,
    results: BatchScoreInput[],
    mode?: "ask" | "search"
  ): string {
    const resultsText = results
      .map(
        (r, i) => `
[RESULT ${i + 1}]
Tool: ${r.tool}
${r.description ? `Expected: ${r.description}` : ""}
Content (truncated to 400 chars):
${r.result.slice(0, 400)}${r.result.length > 400 ? "..." : ""}
`
      )
      .join("\n---\n");

    return `EVALUATE these ${results.length} tool results for the question:
"${query}"

Mode: ${mode || "search"}

${resultsText}

For EACH result, provide a score from 0.0 to 1.0 on:
- confidence: result quality (0=error, 1=perfect)
- relevance: relevance to the question (0=off-topic, 1=highly relevant)
- completeness: sufficient to answer? (0=insufficient, 1=complete)

RETURN THIS EXACT JSON:
{
  "scores": [
    {"confidence": 0.X, "relevance": 0.X, "completeness": 0.X, "reasoning": "..."},
    ... (one for each result)
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
