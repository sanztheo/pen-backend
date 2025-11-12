/**
 * 📊 METRICS SERVICE - Suivi des performances
 *
 * Ce service mesure et compare les métriques d'exécution:
 * - Nombre d'appels API
 * - Latence totale et par phase
 * - Coût estimé (tokens)
 * - Nombre de réflexions
 * - Taux de succès
 *
 * Permet de valider l'impact de l'architecture optimisée vs baseline.
 */

/**
 * Métriques d'exécution
 */
export interface ExecutionMetrics {
  timestamp: number;
  mode: "ask" | "search" | "create_rapide" | "create_profond";
  apiCalls: number;
  latency: number; // ms
  parallelizedTools: number;
  tokenUsage: {
    input: number;
    output: number;
    cached: number;
  };
  cost: number; // USD
  reflectionCount: number;
  successRate: number; // 0-1
  toolsExecuted: number;
}

/**
 * Baseline de comparaison (ancien système)
 */
interface Baseline {
  apiCalls: number;
  latency: number;
  cost: number;
}

/**
 * Service de métriques
 */
export class MetricsService {
  private static metrics: ExecutionMetrics[] = [];

  /**
   * Enregistre les métriques d'une exécution
   *
   * @param execution - Métriques de l'exécution
   */
  static logExecution(execution: ExecutionMetrics): void {
    const metrics = {
      timestamp: Date.now(),
      mode: execution.mode,
      apiCalls: execution.apiCalls,
      latency: execution.latency,
      parallelizedTools: execution.parallelizedTools,
      tokenUsage: execution.tokenUsage,
      cost: execution.cost,
      reflectionCount: execution.reflectionCount,
      successRate: execution.successRate,
      toolsExecuted: execution.toolsExecuted,
    };

    this.metrics.push(metrics);

    console.log("📊 [METRICS] Execution metrics:", {
      mode: metrics.mode,
      apiCalls: metrics.apiCalls,
      latency: `${metrics.latency}ms`,
      cost: `$${metrics.cost.toFixed(4)}`,
      reflections: metrics.reflectionCount,
      toolsExecuted: metrics.toolsExecuted,
      parallelized: metrics.parallelizedTools,
      successRate: `${(metrics.successRate * 100).toFixed(1)}%`,
    });

    // Compare avec le baseline
    this.compareWithBaseline(metrics);
  }

  /**
   * Compare les métriques actuelles avec le baseline (ancien système)
   *
   * Baseline = système avec intermediate thinking après chaque outil
   *
   * @param current - Métriques actuelles
   */
  private static compareWithBaseline(current: ExecutionMetrics): void {
    // Baseline calculé selon le mode
    const baseline = this.getBaseline(current.mode, current.toolsExecuted);

    const improvement = {
      apiCallsReduction:
        ((baseline.apiCalls - current.apiCalls) / baseline.apiCalls) * 100,
      latencyReduction:
        ((baseline.latency - current.latency) / baseline.latency) * 100,
      costReduction: ((baseline.cost - current.cost) / baseline.cost) * 100,
    };

    console.log("📈 [METRICS] Improvements vs baseline:", {
      apiCalls: `${improvement.apiCallsReduction.toFixed(1)}%`,
      latency: `${improvement.latencyReduction.toFixed(1)}%`,
      cost: `${improvement.costReduction.toFixed(1)}%`,
    });

    // Alerte si les métriques sont pires que le baseline
    if (improvement.apiCallsReduction < 0) {
      console.warn(
        `⚠️ [METRICS] REGRESSION: More API calls than baseline!`,
      );
    }
    if (improvement.latencyReduction < 0) {
      console.warn(
        `⚠️ [METRICS] REGRESSION: Higher latency than baseline!`,
      );
    }
  }

  /**
   * Calcule le baseline selon le mode et le nombre d'outils
   *
   * Ancien système:
   * - 1 API call pour planning
   * - N API calls pour intermediate thinking (1 par outil)
   * - 1 API call pour synthesis
   * = 2 + N API calls total
   *
   * @param mode - Mode d'exécution
   * @param toolsCount - Nombre d'outils exécutés
   * @returns Baseline
   */
  private static getBaseline(
    mode: string,
    toolsCount: number,
  ): Baseline {
    // Latence par type d'appel (ms)
    const planningLatency = 1500;
    const intermediateThinkingLatency = 1200; // Par outil
    const synthesisLatency = 1500;
    const toolExecutionLatency = 200; // Par outil (moyenne)

    // Coût par type d'appel (USD)
    // GPT-4o: $2.50 / 1M input tokens, $10.00 / 1M output tokens
    const planningCost = 0.015; // ~4000 input tokens, ~600 output tokens
    const intermediateThinkingCost = 0.012; // ~3000 input tokens, ~400 output tokens
    const synthesisCost = 0.02; // ~5000 input tokens, ~1000 output tokens

    return {
      apiCalls: 2 + toolsCount, // Planning + N intermediate thinking + Synthesis (mais synthesis pas encore implémenté donc 1 + N)
      latency:
        planningLatency +
        intermediateThinkingLatency * toolsCount +
        toolExecutionLatency * toolsCount +
        synthesisLatency,
      cost:
        planningCost +
        intermediateThinkingCost * toolsCount +
        synthesisCost,
    };
  }

  /**
   * Retourne les statistiques agrégées
   *
   * @returns Statistiques agrégées
   */
  static getAggregatedStats(): {
    totalExecutions: number;
    avgApiCalls: number;
    avgLatency: number;
    avgCost: number;
    avgReflections: number;
    avgSuccessRate: number;
  } {
    if (this.metrics.length === 0) {
      return {
        totalExecutions: 0,
        avgApiCalls: 0,
        avgLatency: 0,
        avgCost: 0,
        avgReflections: 0,
        avgSuccessRate: 0,
      };
    }

    const total = this.metrics.length;
    const sum = this.metrics.reduce(
      (acc, m) => ({
        apiCalls: acc.apiCalls + m.apiCalls,
        latency: acc.latency + m.latency,
        cost: acc.cost + m.cost,
        reflections: acc.reflections + m.reflectionCount,
        successRate: acc.successRate + m.successRate,
      }),
      { apiCalls: 0, latency: 0, cost: 0, reflections: 0, successRate: 0 },
    );

    return {
      totalExecutions: total,
      avgApiCalls: sum.apiCalls / total,
      avgLatency: sum.latency / total,
      avgCost: sum.cost / total,
      avgReflections: sum.reflections / total,
      avgSuccessRate: sum.successRate / total,
    };
  }

  /**
   * Réinitialise les métriques (pour les tests)
   */
  static reset(): void {
    this.metrics = [];
    console.log("📊 [METRICS] Metrics reset");
  }

  /**
   * Calcule le coût estimé basé sur l'usage de tokens
   *
   * GPT-4o pricing (Nov 2024):
   * - Input: $2.50 / 1M tokens
   * - Output: $10.00 / 1M tokens
   * - Cached input: $1.25 / 1M tokens (50% discount)
   *
   * @param tokenUsage - Usage de tokens
   * @returns Coût estimé en USD
   */
  static calculateCost(tokenUsage: {
    input: number;
    output: number;
    cached: number;
  }): number {
    const inputCost = (tokenUsage.input / 1_000_000) * 2.5;
    const outputCost = (tokenUsage.output / 1_000_000) * 10.0;
    const cachedCost = (tokenUsage.cached / 1_000_000) * 1.25;

    return inputCost + outputCost + cachedCost;
  }
}
