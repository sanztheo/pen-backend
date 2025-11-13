/**
 * 🧠 THINKING SERVICE - Réflexion Stratégique Conditionnelle
 *
 * Inspiré de l'architecture de Cursor et des systèmes modernes:
 * - Réflexion UNIQUEMENT quand nécessaire (erreurs, ambiguïté, décisions critiques)
 * - PAS de réflexion systématique après chaque outil
 * - Utilise le prompt caching pour réduire les coûts
 *
 * Triggers de réflexion:
 * ✅ Erreur d'exécution d'un outil
 * ✅ Aucune source trouvée (résultats vides)
 * ✅ Résultats ambigus (score < 0.4)
 * ✅ Contradiction entre sources
 * ❌ Tous les outils ont réussi
 * ❌ Sources trouvées et pertinentes (score > 0.7)
 */

import { AIService } from "../base.js";
import { CacheService } from "./cache.service.js";

/**
 * Résultat d'une phase d'exécution
 */
export interface PhaseResult {
  phase: string;
  results: ToolResult[];
  errors: ToolError[];
  validation: ValidationResult;
}

/**
 * Résultat d'un outil individuel
 */
export interface ToolResult {
  tool: string;
  result: any;
  duration: number;
  error: ToolError | null;
}

/**
 * Erreur d'un outil
 */
export interface ToolError {
  message: string;
  critical: boolean;
}

/**
 * Résultat de validation d'une phase
 */
export interface ValidationResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Plan d'outils avec triggers de réflexion
 */
export interface ToolPlan {
  reasoning: string;
  phases: Phase[];
  reflectionTriggers: ReflectionTrigger[];
}

/**
 * Phase d'exécution
 */
export interface Phase {
  name: string;
  tools: PennoteToolCall[];
  execution: "parallel"; // Toujours parallèle pour Pennote!
  reason: string;
}

/**
 * Appel d'outil Pennote
 */
export interface PennoteToolCall {
  toolName:
    | "list_available_sources"
    | "list_global_wikipedia_sources"
    | "select_relevant_sources"
    | "check_sources_rag_status"
    | "read_rag_source"
    | "search_rag_chunks"
    | "search_web"
    | "read_workspace_page"
    | "list_workspace_pages";
  params: Record<string, any>;
}

/**
 * Trigger de réflexion
 */
export interface ReflectionTrigger {
  condition: "error" | "validation_failed" | "ambiguous" | "decision_point";
  threshold?: number;
}

/**
 * Résultat de la réflexion stratégique
 */
export interface ReflectionResult {
  action: "continue" | "retry" | "abort";
  reasoning: string;
  adjustedPhase?: Phase;
}

/**
 * Service de réflexion stratégique conditionnelle
 */
export class ThinkingService {
  /**
   * Réflexion stratégique conditionnelle (0-2 appels API au lieu de N)
   *
   * Cette méthode évalue si une réflexion est nécessaire selon les triggers définis.
   * Si aucun trigger n'est activé, retourne immédiatement sans appel API.
   *
   * @param result - Résultat de la phase d'exécution
   * @param plan - Plan d'outils original
   * @param context - Contexte additionnel
   * @returns Résultat de la réflexion
   */
  static async conditionalReflect(
    result: PhaseResult,
    plan: ToolPlan,
    context: any,
  ): Promise<ReflectionResult> {
    // Vérifier si on doit réfléchir
    if (!this.shouldReflect(result, plan.reflectionTriggers)) {
      console.log(
        `✅ [THINKING] Pas de réflexion nécessaire - phase "${result.phase}" OK`,
      );
      return {
        action: "continue",
        reasoning: "Phase successful, no reflection needed",
      };
    }

    console.log(
      `🧠 [THINKING] Réflexion stratégique nécessaire pour phase "${result.phase}"`,
    );

    // Appel OpenAI avec contexte caché
    const cachedContext = CacheService.getCachedContext();
    const reflection = await AIService.getOpenAI().chat.completions.create({
      model: "gpt-5.1",
      messages: [
        {
          role: "system",
          content: cachedContext.systemPrompt, // CACHED!
        },
        {
          role: "user",
          content: this.buildReflectionPrompt(result, plan),
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = reflection.choices[0]?.message?.content || "{}";
    const parsedReflection = JSON.parse(content) as ReflectionResult;

    console.log(`🧠 [THINKING] Décision: ${parsedReflection.action}`);
    console.log(`   Raison: ${parsedReflection.reasoning}`);

    return parsedReflection;
  }

  /**
   * Détermine si une réflexion est nécessaire
   *
   * Évalue les triggers définis dans le plan et les métriques de la phase.
   *
   * @param result - Résultat de la phase
   * @param triggers - Triggers de réflexion
   * @returns true si réflexion nécessaire
   */
  private static shouldReflect(
    result: PhaseResult,
    triggers: ReflectionTrigger[],
  ): boolean {
    for (const trigger of triggers) {
      switch (trigger.condition) {
        case "error":
          if (result.errors.length > 0) {
            console.log(
              `🔴 [THINKING] Trigger: errors détectées (${result.errors.length})`,
            );
            return true;
          }
          break;

        case "ambiguous":
          // Pour Pennote: vérifier le score de pertinence
          const avgScore = this.calculateAverageScore(result);
          if (avgScore < (trigger.threshold || 0.7)) {
            console.log(
              `🟡 [THINKING] Trigger: score faible (${avgScore.toFixed(2)})`,
            );
            return true;
          }
          break;

        case "validation_failed":
          if (!result.validation.passed) {
            console.log(`🔴 [THINKING] Trigger: validation échouée`);
            return true;
          }
          break;

        case "decision_point":
          // Trigger pour les points de décision critiques
          console.log(`🟡 [THINKING] Trigger: decision point`);
          return true;
      }
    }

    return false;
  }

  /**
   * Calcule le score moyen basé sur les résultats Pennote
   *
   * @param result - Résultat de la phase
   * @returns Score moyen (0-1)
   */
  private static calculateAverageScore(result: PhaseResult): number {
    // Calcul du score moyen basé sur les résultats Pennote
    const scores = result.results
      .filter((r) => !r.error && r.result?.score)
      .map((r) => r.result.score);

    if (scores.length === 0) return 0;
    return scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
  }

  /**
   * Construit le prompt de réflexion stratégique
   *
   * @param result - Résultat de la phase
   * @param plan - Plan original
   * @returns Prompt de réflexion
   */
  private static buildReflectionPrompt(
    result: PhaseResult,
    plan: ToolPlan,
  ): string {
    const errorSummary =
      result.errors.length > 0
        ? `\n\nErrors encountered:\n${result.errors.map((e) => `- ${e.message}`).join("\n")}`
        : "";

    const resultSummary = result.results
      .map((r) => {
        if (r.error) {
          return `- ${r.tool}: ERROR (${r.error.message})`;
        }
        return `- ${r.tool}: SUCCESS (${r.duration}ms)`;
      })
      .join("\n");

    return `Analyze the following execution phase and determine next steps.

Phase: ${result.phase}
Tools executed: ${result.results.map((r) => r.tool).join(", ")}
Validation: ${result.validation.passed ? "Passed" : "Failed"}

Results summary:
${resultSummary}${errorSummary}

Original plan reasoning: ${plan.reasoning}

Based on the results, determine the best action:
- "continue": Results are satisfactory, continue with the plan
- "retry": Results are insufficient, retry with adjusted parameters
- "abort": Critical error, cannot continue

Provide a JSON response with:
{
  "action": "continue" | "retry" | "abort",
  "reasoning": "<why this action>",
  "adjustedPhase": <optional new phase if retry>
}`;
  }
}
