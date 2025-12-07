/**
 * 🚀 OPTIMIZED EXECUTOR SERVICE - Parallel Execution Sans Intermediate Thinking Systématique
 *
 * Architecture inspirée de Cursor:
 * - PAS de réflexion intermédiaire systématique après chaque outil
 * - Exécution parallèle de TOUS les outils Pennote (100% read-only!)
 * - Arguments fournis directement par le Planner (pas de génération dynamique)
 * - Réduction de 75-83% des appels API
 * - Réduction de >80% de la latence
 *
 * Ancien système:
 * Plan → Tool 1 → Reflect → Tool 2 → Reflect → ... (12 API calls pour 10 tools)
 *
 * Nouveau système:
 * Plan → Execute All Tools (parallèle) → Strategic Reflection (conditionnel) (2-3 API calls)
 */

import { ToolExecutor, type ToolContext } from "../tools/executors.js";
import type { PhaseResult, ToolResult, ToolError, ValidationResult } from "./thinking.service.js";

/**
 * Contexte d'exécution simplifiée
 */
export interface OptimizedExecutionContext {
  userId: string;
  workspaceId: string;
  query: string;
}

/**
 * Plan d'outils à exécuter (fourni par PlannerService)
 */
export interface ToolExecutionPlan {
  tools: Array<{
    toolName: string;
    params: any;
    description: string;
  }>;
  parallelizable: boolean; // Pour Pennote: toujours true!
}

/**
 * Résultat d'exécution global
 */
export interface BatchExecutionResult {
  results: ToolResult[];
  duration: number;
  apiCallsUsed: number; // Toujours 0 pour l'exécution (les outils ne font pas d'appels API)
  successRate: number;
}

/**
 * Service d'exécution optimisé
 */
export class OptimizedExecutorService {
  /**
   * 🚀 Exécute un batch d'outils en parallèle (0 API calls)
   *
   * AVANTAGE PENNOTE : Tous les outils sont read-only, donc 100% parallélisable!
   *
   * @param plan - Plan d'exécution
   * @param context - Contexte d'exécution
   * @param callbacks - Callbacks optionnels
   * @returns Résultat d'exécution
   */
  static async executeBatch(
    plan: ToolExecutionPlan,
    context: OptimizedExecutionContext,
    callbacks?: {
      onToolStart?: (toolName: string, params: any) => void;
      onToolComplete?: (toolName: string, result: string) => void;
    },
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();

    console.log(
      `⚡ [OPTIMIZED-EXECUTOR] Exécution parallèle de ${plan.tools.length} outils...`,
    );

    // 🎁 PENNOTE ADVANTAGE: Tous les outils sont read-only!
    // On peut TOUJOURS exécuter en parallèle
    const results = await Promise.all(
      plan.tools.map((tool) =>
        this.executeSingleTool(tool, context, callbacks),
      ),
    );

    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => !r.error).length;
    const successRate = successCount / results.length;

    console.log(
      `✅ [OPTIMIZED-EXECUTOR] Batch complété en ${duration}ms (${successCount}/${results.length} succès)`,
    );

    return {
      results,
      duration,
      apiCallsUsed: 0, // Pas d'appels API pour l'exécution!
      successRate,
    };
  }

  /**
   * 🚀 Exécute un batch avec réponse incrémentale (2 vagues)
   *
   * Déclenche un callback dès que 30% des résultats sont prêts,
   * permettant de générer une réponse partielle.
   *
   * @param plan - Plan d'exécution
   * @param context - Contexte d'exécution
   * @param callbacks - Callbacks incluant onPartialResults
   * @returns Résultat d'exécution
   */
  static async executeBatchIncremental(
    plan: ToolExecutionPlan,
    context: OptimizedExecutionContext,
    callbacks?: {
      onToolStart?: (toolName: string, params: any) => void;
      onToolComplete?: (toolName: string, result: string) => void;
      onPartialResults?: (results: ToolResult[], completedRatio: number) => void;
    },
  ): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const totalTools = plan.tools.length;
    const partialThreshold = Math.ceil(totalTools * 0.3); // 30%
    let partialTriggered = false;

    console.log(
      `⚡ [INCREMENTAL-EXECUTOR] Exécution incrémentale de ${totalTools} outils (seuil: ${partialThreshold})...`,
    );

    const results: ToolResult[] = [];
    const promises: Promise<ToolResult>[] = [];

    // Lancer tous les tools en parallèle mais tracker individuellement
    for (const tool of plan.tools) {
      const promise = this.executeSingleTool(tool, context, {
        onToolStart: callbacks?.onToolStart,
        onToolComplete: (toolName, result) => {
          callbacks?.onToolComplete?.(toolName, result);
        },
      }).then((result) => {
        results.push(result);

        // 🚀 Déclencher partial dès qu'on atteint le seuil
        if (!partialTriggered && results.length >= partialThreshold) {
          partialTriggered = true;
          const completedRatio = results.length / totalTools;
          console.log(
            `📤 [INCREMENTAL-EXECUTOR] Seuil atteint! ${results.length}/${totalTools} (${(completedRatio * 100).toFixed(0)}%)`,
          );
          callbacks?.onPartialResults?.(
            [...results], // Copie pour éviter mutations
            completedRatio,
          );
        }

        return result;
      });
      promises.push(promise);
    }

    // Attendre tous les résultats
    await Promise.all(promises);

    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => !r.error).length;
    const successRate = successCount / results.length;

    console.log(
      `✅ [INCREMENTAL-EXECUTOR] Batch complété en ${duration}ms (${successCount}/${results.length} succès)`,
    );

    return {
      results,
      duration,
      apiCallsUsed: 0,
      successRate,
    };
  }

  /**
   * 🔧 Exécute un outil individuel
   *
   * @param tool - Outil à exécuter
   * @param context - Contexte
   * @param callbacks - Callbacks optionnels
   * @returns Résultat d'exécution
   */
  private static async executeSingleTool(
    tool: { toolName: string; params: any; description: string },
    context: OptimizedExecutionContext,
    callbacks?: {
      onToolStart?: (toolName: string, params: any) => void;
      onToolComplete?: (toolName: string, result: string) => void;
    },
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      console.log(`🔧 [OPTIMIZED-EXECUTOR] Start: ${tool.toolName}`);

      if (callbacks?.onToolStart) {
        callbacks.onToolStart(tool.toolName, tool.params);
      }

      // Exécution via ToolExecutor existant
      const toolContext: ToolContext = {
        userId: context.userId,
        workspaceId: context.workspaceId,
      };

      const result = await ToolExecutor.executeToolCall(
        tool.toolName,
        tool.params,
        toolContext,
      );

      const duration = Date.now() - startTime;

      console.log(
        `✅ [OPTIMIZED-EXECUTOR] Complete: ${tool.toolName} (${duration}ms)`,
      );

      if (callbacks?.onToolComplete) {
        callbacks.onToolComplete(tool.toolName, result);
      }

      return {
        tool: tool.toolName,
        result,
        duration,
        error: null,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(
        `❌ [OPTIMIZED-EXECUTOR] Error: ${tool.toolName}`,
        error,
      );

      return {
        tool: tool.toolName,
        result: null,
        duration,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown error",
          critical: this.isCriticalError(error),
        },
      };
    }
  }

  /**
   * Détermine si une erreur est critique
   *
   * Erreurs critiques qui doivent arrêter l'exécution:
   * - Rate limit
   * - Auth failed
   * - Network timeout (>30s)
   *
   * @param error - Erreur
   * @returns true si critique
   */
  private static isCriticalError(error: any): boolean {
    const message = error?.message || "";
    return (
      message.includes("RATE_LIMIT") ||
      message.includes("AUTH_FAILED") ||
      message.includes("ECONNREFUSED") ||
      message.includes("ETIMEDOUT")
    );
  }

  /**
   * Valide les résultats d'une phase
   *
   * @param results - Résultats des outils
   * @returns Résultat de validation
   */
  static validateResults(results: ToolResult[]): ValidationResult {
    const errors = results.filter((r) => r.error).map((r) => r.error!);
    const criticalErrors = errors.filter((e) => e.critical);
    const hasErrors = errors.length > 0;
    const allSucceeded = errors.length === 0;

    const warnings: string[] = [];
    if (hasErrors && criticalErrors.length === 0) {
      warnings.push(
        `${errors.length} tool(s) failed but no critical errors`,
      );
    }

    return {
      passed: allSucceeded,
      warnings,
      errors: errors.map((e) => e.message),
    };
  }

  /**
   * 🔄 Extrait les sources des résultats d'outils
   *
   * Fonctionne pour list_available_sources et list_global_wikipedia_sources
   *
   * @param results - Résultats des outils
   * @returns Sources extraites
   */
  static extractSourcesFromResults(
    results: ToolResult[],
  ): Array<{ id: string; title: string; sourceType: string }> {
    const sources: Array<{ id: string; title: string; sourceType: string }> =
      [];

    for (const result of results) {
      if (
        result.tool !== "list_available_sources" &&
        result.tool !== "list_global_wikipedia_sources"
      ) {
        continue;
      }

      if (!result.result || result.error) {
        continue;
      }

      try {
        // Parse source listings from the result (format: "ID: XXX")
        const sourceMatches = result.result.match(/ID: ([a-f0-9\-]+)/g);
        if (sourceMatches) {
          sourceMatches.forEach((match: string) => {
            const id = match.replace("ID: ", "");
            const lines = result.result.split("\n");
            const matchIdx = lines.findIndex((line: string) =>
              line.includes(match),
            );

            if (matchIdx > 0) {
              const titleLine = lines[matchIdx - 3] || "";
              const titleMatch = titleLine.match(/\d+\.\s*\[.+?\]\s*(.+)/);
              const title = titleMatch ? titleMatch[1] : "Unknown";

              const typeLineIdx = lines.findIndex(
                (line: string, idx: number) =>
                  idx > matchIdx - 3 && line.startsWith("   Type:"),
              );
              const typeMatch =
                typeLineIdx >= 0
                  ? lines[typeLineIdx].match(/Type:\s*(.+)/)
                  : null;
              const sourceType = typeMatch
                ? typeMatch[1].trim()
                : "WIKIPEDIA";

              // Éviter les doublons
              if (!sources.find((s) => s.id === id)) {
                sources.push({ id, title, sourceType });
              }
            }
          });

          console.log(
            `🔄 [OPTIMIZED-EXECUTOR] Extracted ${sources.length} sources from ${result.tool}`,
          );
        }
      } catch (parseError) {
        console.warn(
          `⚠️ [OPTIMIZED-EXECUTOR] Failed to extract sources from ${result.tool}:`,
          parseError,
        );
      }
    }

    return sources;
  }
}
