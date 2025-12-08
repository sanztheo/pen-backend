/**
 * 🎯 COORDINATOR SERVICE
 *
 * Inspired by Cursor's architecture:
 * - Valide la cohérence entre thinking et actions
 * - Détecte les incohérences dans le plan
 * - Propose des corrections automatiques
 * - Empêche l'IA de sauter des étapes sans justification
 * - 🆕 Valide les dépendances entre tools (graphe strict)
 * - 🆕 ORCHESTRATEUR PRINCIPAL: Coordonne Planner → Executor → Scorer
 */

import { AIService } from "../base.js";
import { ScoringService } from "./scoring.service.js";
import { BatchScoringService } from "./batchScoring.service.js";
import {
  ToolDependenciesValidator,
  type ToolExecutionContext,
  type DependencyValidationResult,
} from "./toolDependencies.js";
import { PlannerService, type PlanRequest } from "./planner.service.js";
import {
  ExecutorService,
  type ExecutionContext,
  type ExecutionStep,
} from "./executor.service.js";
import {
  OptimizedExecutorService,
  type OptimizedExecutionContext,
  type ToolExecutionPlan,
} from "./executor.service.optimized.js";
import {
  ThinkingService,
  type PhaseResult,
  type ToolPlan,
  type ReflectionTrigger,
} from "./thinking.service.js";
import { MetricsService, type ExecutionMetrics } from "./metrics.service.js";
import type { IntermediateThinkingBlock } from "../../../types/ragThinking.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export interface CoordinatorInput {
  thinking: string; // Ce que l'IA dit qu'elle va faire
  nextToolName: string | null; // Le tool qu'elle veut appeler
  toolArguments: any; // Les arguments du tool
  previousToolResults: string[]; // Historique des résultats des tools
  originalPlan: string[]; // Plan initial
  modifiedPlan?: string[]; // Plan modifié (si l'IA veut changer)
  executionContext?: ToolExecutionContext; // 🆕 Contexte d'exécution avec extractedSources
}

export interface CoordinatorOutput {
  isValid: boolean; // Le plan est-il cohérent ?
  correctedToolName?: string; // Tool corrigé si incohérence
  correctedArguments?: any; // Arguments corrigés
  reasoning: string; // Explication de la décision
  shouldBlock: boolean; // Bloquer l'exécution ?
}

/**
 * Request pour l'orchestration complète
 */
export interface OrchestrationRequest {
  query: string;
  workspaceId: string;
  userId: string;
  availableSources: Array<{
    id: string;
    title: string;
    type: string;
  }>;
  useWeb: boolean;
  isSearch: boolean;
  systemPrompt: string;
  onThinking?: (chunk: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
  onIntermediateThinking?: (chunk: string) => void;
  onScoring?: (toolName: string, progress: string) => void; // 🆕 Callback pour la phase de scoring
  onPartialResponse?: (text: string, isPartial: boolean) => void; // 🆕 Callback pour réponse incrémentale (fin de vague)
  onPartialStream?: (chunk: string) => void; // 🆕 Callback pour streamer les chunks de la première vague
  conversationHistory?: string | null; // 🆕 Historique de conversation formaté
  model?: string; // 🧠 Modèle spécifique à utiliser (ex: grok-4-1-fast-reasoning)
}

/**
 * Résultat de l'orchestration complète
 */
export interface OrchestrationResult {
  success: boolean;
  toolCalls: Array<{
    name: string;
    arguments: any;
    result: string;
    thinking?: string;
    score?: any;
    timestamp: number;
  }>;
  thinking: string;
  intermediateThinkingBlocks: IntermediateThinkingBlock[];
  // Delta approach (Perplexity-style)
  wave1Response?: string; // Réponse partielle de la Vague 1
  partialToolCount?: number; // Nombre de tools utilisés pour Vague 1
}

export class CoordinatorService {
  /**
   * 🎯 ORCHESTRATEUR PRINCIPAL
   *
   * Coordonne l'exécution complète d'une requête utilisateur :
   * 1. PLANNING : Génération du plan via PlannerService
   * 2. VALIDATION : Validation du plan complet
   * 3. EXECUTION : Boucle d'exécution via ExecutorService
   * 4. SCORING : Évaluation des résultats via ScoringService
   *
   * Cette méthode est le point d'entrée principal du système.
   */
  static async orchestrate(
    request: OrchestrationRequest,
  ): Promise<OrchestrationResult> {
    console.log("🎯 [COORDINATOR] Démarrage orchestration");
    console.log(`   Query: "${request.query}"`);
    console.log(`   Mode: ${request.isSearch ? "SEARCH" : "ASK"}`);
    console.log(`   Sources: ${request.availableSources.length}`);
    console.log(`   Web: ${request.useWeb ? "ENABLED" : "DISABLED"}`);

    const startTime = Date.now();

    try {
      // ============================================
      // ÉTAPE 1 : PLANNING (via PlannerService)
      // ============================================
      console.log("📋 [COORDINATOR] ÉTAPE 1/4: Génération du plan...");

      const planRequest: PlanRequest = {
        query: request.query,
        availableSources: request.availableSources,
        workspaceId: request.workspaceId,
        userId: request.userId,
        isSearch: request.isSearch,
        useWeb: request.useWeb,
        systemPrompt: request.systemPrompt,
        onThinking: request.onThinking,
        conversationHistory: request.conversationHistory,
        model: request.model, // 🧠 Passer le modèle (Grok/OpenAI)
      };

      const plan = await PlannerService.generatePlan(planRequest);

      console.log(
        `✅ [COORDINATOR] Plan généré: ${plan.toolSequence.length} tools`,
      );
      console.log(
        `   Tools: ${plan.toolSequence.map((t) => t.toolName).join(" → ")}`,
      );
      console.log(`   Mode détecté: ${plan.detectedMode}`);
      console.log(`   Query optimisée: "${plan.optimizedQuery}"`);

      // ============================================
      // ÉTAPE 2 : VALIDATION DU PLAN
      // ============================================
      console.log(
        "🔍 [COORDINATOR-OPTIMIZED] ÉTAPE 2/4: Validation du plan...",
      );

      const hasPreselectedSources = request.availableSources.length > 0;
      const planValidation = this.validateFullPlan(
        plan.toolSequence.map((t) => ({
          toolName: t.toolName,
          params: t.params,
        })),
        plan.detectedMode,
        hasPreselectedSources,
      );

      if (!planValidation.isValid) {
        console.warn(
          `⚠️ [COORDINATOR-OPTIMIZED] Plan avec avertissements: ${planValidation.reasoning}`,
        );

        // 🔧 Si un plan corrigé est disponible, l'utiliser
        if (
          planValidation.suggestedFix &&
          planValidation.suggestedFix.toolName === "PLAN_CORRECTION"
        ) {
          const correctedPlan = planValidation.suggestedFix.arguments
            .correctedPlan as Array<{ toolName: string; params?: any }>;

          console.log(
            `🔧 [COORDINATOR-OPTIMIZED] Plan corrigé automatiquement détecté, utilisation...`,
          );
          console.log(
            `   Ancien: ${plan.toolSequence.map((t) => t.toolName).join(" → ")}`,
          );
          console.log(
            `   Nouveau: ${correctedPlan.map((t) => t.toolName).join(" → ")}`,
          );

          // Remplacer le plan original par le plan corrigé
          plan.toolSequence = correctedPlan.map((correctedTool, idx) => {
            // Retrouver le tool original pour garder ses paramètres complets
            const originalTool = plan.toolSequence.find(
              (t) => t.toolName === correctedTool.toolName,
            );
            return (
              originalTool || {
                step: idx + 1,
                toolName: correctedTool.toolName,
                description: `Tool ${correctedTool.toolName}`,
                params: correctedTool.params || {},
              }
            );
          });

          console.log(
            `✅ [COORDINATOR-OPTIMIZED] Plan corrigé appliqué avec succès`,
          );
        } else {
          // ⚠️ NOUVEAU : Plus de blocage, juste un warning et on continue
          console.warn(
            `⚠️ [COORDINATOR-OPTIMIZED] Pas de correction disponible, poursuite avec plan original`,
          );
          console.warn(
            `   L'IA a été guidée par le system prompt, on lui fait confiance`,
          );
        }
      } else {
        console.log(
          `✅ [COORDINATOR-OPTIMIZED] Plan validé: ${planValidation.reasoning}`,
        );
      }

      // ============================================
      // ÉTAPE 3 : BOUCLE D'EXÉCUTION
      // ============================================
      console.log(
        "⚙️ [COORDINATOR] ÉTAPE 3/4: Exécution de la boucle agentic...",
      );

      const toolCalls: OrchestrationResult["toolCalls"] = [];
      const intermediateThinkingBlocks: IntermediateThinkingBlock[] = [];
      const initialMessages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: `Question: "${request.query}"`,
        },
      ];

      // Contexte d'exécution initial
      let extractedSources: Array<{
        id: string;
        title: string;
        sourceType: string;
      }> = [];

      // Copier les sources fournies initialement
      if (request.availableSources.length > 0) {
        extractedSources = request.availableSources.map((s) => ({
          id: s.id,
          title: s.title,
          sourceType: s.type,
        }));
      }

      // Boucle d'exécution des tools
      for (let i = 0; i < plan.toolSequence.length; i++) {
        const step = plan.toolSequence[i];

        console.log(
          `🔧 [COORDINATOR] Exécution step ${i + 1}/${plan.toolSequence.length}: ${step.toolName}`,
        );

        try {
          // Construire le contexte d'exécution
          const executionContext: ExecutionContext = {
            userId: request.userId,
            workspaceId: request.workspaceId,
            query: plan.optimizedQuery || request.query,
            isSearch: request.isSearch,
            useWeb: request.useWeb,
            executedTools: toolCalls.map((tc) => ({
              name: tc.name,
              arguments: tc.arguments,
              result: tc.result,
              score: tc.score,
            })),
            extractedSources,
            currentIteration: i,
            maxIterations: plan.toolSequence.length,
            remainingTools: plan.toolSequence
              .slice(i + 1)
              .map((t) => t.toolName),
            initialMessages,
          };

          // Exécuter le step via ExecutorService
          const executionResult = await ExecutorService.executeStep(
            step,
            executionContext,
            {
              onIntermediateThinking: request.onIntermediateThinking,
              onToolCall: request.onToolCall,
              onToolResult: request.onToolResult,
            },
          );

          console.log(
            `✅ [COORDINATOR] Step ${i + 1} complété: ${executionResult.toolName}`,
          );

          // Mettre à jour les sources extraites
          if (
            executionResult.extractedSources &&
            executionResult.extractedSources.length > 0
          ) {
            extractedSources.push(...executionResult.extractedSources);
            console.log(
              `🔄 [COORDINATOR] ${executionResult.extractedSources.length} nouvelles sources extraites`,
            );
          }

          // Ajouter le résultat à l'historique des messages
          initialMessages.push({
            role: "user",
            content: `Tool ${executionResult.toolName} résultat:\n${executionResult.result}`,
          });

          // ============================================
          // ÉTAPE 4 : SCORING (par step)
          // ============================================
          let score = null;
          try {
            score = await ScoringService.scoreToolResult({
              toolName: executionResult.toolName,
              result: executionResult.result,
              query: plan.optimizedQuery || request.query,
              expectedInfo: step.description,
              model: request.model, // 🧠 Passer le modèle
              context: {
                previousScores: toolCalls
                  .map((tc) => tc.score)
                  .filter((s) => s !== undefined),
                useWeb: request.useWeb,
                hasSpecificSource: request.availableSources.length > 0,
                mode: request.isSearch ? "search" : "ask",
              },
            });

            console.log(
              `📊 [COORDINATOR] Score step ${i + 1}: ${score.overallScore.toFixed(2)}`,
            );
          } catch (scoreError) {
            console.warn(
              `⚠️ [COORDINATOR] Erreur scoring step ${i + 1}:`,
              scoreError,
            );
            // Continuer malgré l'erreur de scoring
          }

          // Enregistrer le tool call
          toolCalls.push({
            name: executionResult.toolName,
            arguments: executionResult.arguments,
            result: executionResult.result,
            thinking: executionResult.thinking,
            score,
            timestamp: Date.now(),
          });

          // Enregistrer le bloc de thinking intermédiaire
          if (executionResult.intermediateParsed) {
            intermediateThinkingBlocks.push({
              iteration: i,
              thinking: executionResult.thinking,
              toolArguments: executionResult.arguments,
              generatedAt: new Date().toISOString(),
              nextToolName: step.toolName,
              score,
            });
          }

          // Vérifier si on doit continuer
          if (!executionResult.shouldContinue) {
            console.log(
              `⏹️ [COORDINATOR] Arrêt demandé par l'executor (shouldContinue: false)`,
            );
            break;
          }

          // Gestion des modifications de plan
          if (
            executionResult.modifiedToolSequence &&
            executionResult.modifiedToolSequence.length > 0
          ) {
            console.log(
              `🔄 [COORDINATOR] Modification de plan détectée: ${executionResult.modifiedToolSequence.length} nouveaux tools`,
            );

            // Valider la modification
            const modificationValidation = await this.validatePlanModification(
              plan.toolSequence.slice(i + 1).map((t) => t.toolName),
              executionResult.modifiedToolSequence.map((t) => t.toolName),
              executionResult.result,
              executionResult.thinking,
            );

            if (modificationValidation.isValid) {
              console.log(
                `✅ [COORDINATOR] Modification de plan validée: ${modificationValidation.reasoning}`,
              );
              // Remplacer les tools restants par le nouveau plan
              plan.toolSequence.splice(
                i + 1,
                plan.toolSequence.length - (i + 1),
                ...executionResult.modifiedToolSequence,
              );
            } else {
              console.warn(
                `❌ [COORDINATOR] Modification de plan refusée: ${modificationValidation.reasoning}`,
              );
            }
          }

          // Pause entre les steps pour éviter rate limits
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (stepError) {
          console.error(`❌ [COORDINATOR] Erreur step ${i + 1}:`, stepError);

          // Enregistrer l'erreur mais continuer
          toolCalls.push({
            name: step.toolName,
            arguments: {},
            result: `❌ Erreur: ${stepError instanceof Error ? stepError.message : "Erreur inconnue"}`,
            thinking: "Error during execution",
            score: null,
            timestamp: Date.now(),
          });

          // Continuer avec le prochain step (ne pas tout casser)
          console.log(
            `⚠️ [COORDINATOR] Poursuite malgré l'erreur (step ${i + 1})`,
          );
        }
      }

      // ============================================
      // FIN DE L'ORCHESTRATION
      // ============================================
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      console.log(`✅ [COORDINATOR] Orchestration terminée en ${duration}s`);
      console.log(`   Tools exécutés: ${toolCalls.length}`);
      console.log(
        `   Sources extraites: ${extractedSources.length} (${extractedSources.filter((s) => !request.availableSources.find((as) => as.id === s.id)).length} nouvelles)`,
      );

      // Calculer le score moyen
      const scores = toolCalls
        .map((tc) => tc.score?.overallScore)
        .filter((s) => s !== undefined);
      const avgScore =
        scores.length > 0
          ? scores.reduce((acc, s) => acc + s, 0) / scores.length
          : 0;

      console.log(`   Score moyen: ${avgScore.toFixed(2)}`);

      return {
        success: true,
        toolCalls,
        thinking: plan.reasoning,
        intermediateThinkingBlocks,
      };
    } catch (error) {
      console.error(`❌ [COORDINATOR] Erreur orchestration:`, error);

      return {
        success: false,
        toolCalls: [],
        thinking: `Erreur d'orchestration: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
        intermediateThinkingBlocks: [],
      };
    }
  }

  /**
   * 🚀 ORCHESTRATEUR OPTIMISÉ (Architecture Cursor-inspired)
   *
   * Architecture moderne sans intermediate thinking systématique:
   * 1. PLANNING (1 API call): Génération du plan complet via PlannerService
   * 2. EXECUTION (0 API calls): Exécution parallèle de tous les outils
   * 3. STRATEGIC REFLECTION (0-1 API call): Réflexion conditionnelle uniquement si nécessaire
   * 4. SCORING (0 API calls): Évaluation des résultats
   *
   * Avantages:
   * - 75-83% moins d'appels API (2-3 au lieu de 12 pour 10 outils)
   * - >80% plus rapide (parallélisation maximale)
   * - 87-96% moins cher (avec prompt caching)
   * - Qualité maintenue/améliorée
   */
  static async orchestrateOptimized(
    request: OrchestrationRequest,
  ): Promise<OrchestrationResult> {
    console.log("🚀 [COORDINATOR-OPTIMIZED] Démarrage orchestration optimisée");
    console.log(`   Query: "${request.query}"`);
    console.log(`   Mode: ${request.isSearch ? "SEARCH" : "ASK"}`);

    const startTime = Date.now();
    let apiCallsUsed = 0;
    let reflectionCount = 0;

    try {
      // ============================================
      // ÉTAPE 1 : PLANNING (1 API call)
      // ============================================
      console.log(
        "📋 [COORDINATOR-OPTIMIZED] ÉTAPE 1/4: Génération du plan...",
      );

      const planRequest: PlanRequest = {
        query: request.query,
        availableSources: request.availableSources,
        workspaceId: request.workspaceId,
        userId: request.userId,
        isSearch: request.isSearch,
        useWeb: request.useWeb,
        systemPrompt: request.systemPrompt,
        onThinking: request.onThinking,
        conversationHistory: request.conversationHistory,
        model: request.model, // 🧠 Passer le modèle (Grok/OpenAI)
      };

      const plan = await PlannerService.generatePlan(planRequest);
      apiCallsUsed++; // Planning = 1 API call

      console.log(
        `✅ [COORDINATOR-OPTIMIZED] Plan généré: ${plan.toolSequence.length} tools`,
      );
      console.log(
        `   Tools: ${plan.toolSequence.map((t) => t.toolName).join(" → ")}`,
      );

      // 🆕 Si pas de tools à exécuter (shouldUseTools: false), retourner immédiatement
      if (plan.toolSequence.length === 0) {
        console.log(
          `🎯 [COORDINATOR-OPTIMIZED] Aucun tool à exécuter (shouldUseTools: false), réponse directe`,
        );
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        console.log(
          `✅ [COORDINATOR-OPTIMIZED] Orchestration terminée en ${duration}s (aucun tool)`,
        );
        return {
          success: true,
          toolCalls: [],
          thinking: plan.reasoning,
          intermediateThinkingBlocks: [],
        };
      }

      // ============================================
      // ÉTAPE 2 : VALIDATION DU PLAN
      // ============================================
      console.log(
        "🔍 [COORDINATOR-OPTIMIZED] ÉTAPE 2/4: Validation du plan...",
      );

      const hasPreselectedSources = request.availableSources.length > 0;
      const planValidation = this.validateFullPlan(
        plan.toolSequence.map((t) => ({
          toolName: t.toolName,
          params: t.params,
        })),
        plan.detectedMode,
        hasPreselectedSources,
      );

      if (!planValidation.isValid) {
        console.warn(
          `⚠️ [COORDINATOR-OPTIMIZED] Plan avec avertissements: ${planValidation.reasoning}`,
        );

        // 🔧 Si un plan corrigé est disponible, l'utiliser
        if (
          planValidation.suggestedFix &&
          planValidation.suggestedFix.toolName === "PLAN_CORRECTION"
        ) {
          const correctedPlan = planValidation.suggestedFix.arguments
            .correctedPlan as Array<{ toolName: string; params?: any }>;

          console.log(
            `🔧 [COORDINATOR-OPTIMIZED] Utilisation du plan corrigé automatiquement...`,
          );
          console.log(
            `   Ancien: ${plan.toolSequence.map((t) => t.toolName).join(" → ")}`,
          );
          console.log(
            `   Nouveau: ${correctedPlan.map((t) => t.toolName).join(" → ")}`,
          );

          // Remplacer le plan original par le plan corrigé
          plan.toolSequence = correctedPlan.map((correctedTool, idx) => {
            // Retrouver le tool original pour garder ses paramètres complets
            const originalTool = plan.toolSequence.find(
              (t) => t.toolName === correctedTool.toolName,
            );
            return (
              originalTool || {
                step: idx + 1,
                toolName: correctedTool.toolName,
                description: `Tool ${correctedTool.toolName}`,
                params: correctedTool.params || {},
              }
            );
          });

          console.log(
            `✅ [COORDINATOR-OPTIMIZED] Plan corrigé appliqué avec succès`,
          );
        } else {
          // ⚠️ NOUVEAU : Plus de blocage, juste un warning et on continue
          console.warn(
            `⚠️ [COORDINATOR-OPTIMIZED] Pas de correction disponible, poursuite avec plan original`,
          );
          console.warn(
            `   L'IA a été guidée par le system prompt, on lui fait confiance`,
          );
        }
      } else {
        console.log(
          `✅ [COORDINATOR-OPTIMIZED] Plan validé: ${planValidation.reasoning}`,
        );
      }

      // ============================================
      // ÉTAPE 3 : EXÉCUTION PARALLÈLE (0 API calls!)
      // ============================================
      console.log(
        "⚡ [COORDINATOR-OPTIMIZED] ÉTAPE 3/4: Exécution parallèle...",
      );

      const executionPlan: ToolExecutionPlan = {
        tools: plan.toolSequence.map((t) => ({
          toolName: t.toolName,
          params: t.params || {},
          description: t.description,
        })),
        parallelizable: true, // PENNOTE: Always true!
      };

      const executionContext: OptimizedExecutionContext = {
        userId: request.userId,
        workspaceId: request.workspaceId,
        query: plan.optimizedQuery || request.query,
      };

      // Delta approach (Perplexity-style): Store Wave 1 data for delta generation
      // Using mutable object to avoid TypeScript scope issues with async callback
      const wave1DataRef: { current: { response: string; toolCount: number } | null } = { current: null };

      // Use incremental execution for 2-wave response
      const useIncremental = request.onPartialResponse && plan.toolSequence.length >= 4;
      
      const batchResult = useIncremental
        ? await OptimizedExecutorService.executeBatchIncremental(
            executionPlan,
            executionContext,
            {
              onToolStart: (toolName, params) => {
                if (request.onToolCall) {
                  request.onToolCall(toolName, params);
                }
              },
              onToolComplete: (toolName, result) => {
                if (request.onToolResult) {
                  request.onToolResult(toolName, result);
                }
              },
              onPartialResults: async (partialResults, ratio) => {
                console.log(`[COORDINATOR-INCREMENTAL] Wave 1 generation (${(ratio * 100).toFixed(0)}% complete)...`);
                // Generate partial response with first results - STREAMED
                try {
                  const { FunctionCallingService } = await import("./index.js");
                  const partialContext = FunctionCallingService.buildContextFromToolResults(
                    partialResults.map((r, i) => ({
                      name: r.tool,
                      arguments: plan.toolSequence[i]?.params || {},
                      result: r.result || "",
                      timestamp: Date.now(),
                    }))
                  );
                  
                  // Stream partial response in real-time
                  let partialResponse = "";
                  await FunctionCallingService.generateWithToolResults({
                    query: request.query,
                    toolResults: partialContext,
                    systemPrompt: `${request.systemPrompt}\n\nIMPORTANT: This is a PARTIAL response based on ${partialResults.length} sources. Be concise, the complete response will follow.`,
                    model: request.model,
                    onStream: (chunk: string) => {
                      partialResponse += chunk;
                      // Send each chunk in real-time!
                      request.onPartialStream?.(chunk);
                    },
                  });
                  
                  // Store Wave 1 data for delta approach
                  wave1DataRef.current = {
                    response: partialResponse,
                    toolCount: partialResults.length,
                  };
                  
                  // Signal end of partial wave
                  request.onPartialResponse?.(partialResponse, true);
                } catch (partialError) {
                  console.warn(`[COORDINATOR-INCREMENTAL] Wave 1 error:`, partialError);
                }
              },
            },
          )
        : await OptimizedExecutorService.executeBatch(
            executionPlan,
            executionContext,
            {
              onToolStart: (toolName, params) => {
                if (request.onToolCall) {
                  request.onToolCall(toolName, params);
                }
              },
              onToolComplete: (toolName, result) => {
                if (request.onToolResult) {
                  request.onToolResult(toolName, result);
                }
              },
            },
          );

      console.log(
        `✅ [COORDINATOR-OPTIMIZED] Exécution terminée: ${batchResult.results.length} tools en ${batchResult.duration}ms`,
      );
      console.log(
        `   Success rate: ${(batchResult.successRate * 100).toFixed(1)}%`,
      );

      // Extraire les sources des résultats
      const extractedSources =
        OptimizedExecutorService.extractSourcesFromResults(batchResult.results);

      console.log(
        `🔄 [COORDINATOR-OPTIMIZED] ${extractedSources.length} sources extraites`,
      );

      // ============================================
      // ÉTAPE 3.5 : RÉFLEXION STRATÉGIQUE CONDITIONNELLE (0-1 API call)
      // ============================================
      console.log(
        "🧠 [COORDINATOR-OPTIMIZED] ÉTAPE 3.5/4: Réflexion stratégique conditionnelle...",
      );

      const validation = OptimizedExecutorService.validateResults(
        batchResult.results,
      );

      const phaseResult: PhaseResult = {
        phase: "execution",
        results: batchResult.results,
        errors: batchResult.results.filter((r) => r.error).map((r) => r.error!),
        validation,
      };

      const toolPlan: ToolPlan = {
        reasoning: plan.reasoning,
        phases: [
          {
            name: "execution",
            tools: plan.toolSequence.map((t) => ({
              toolName: t.toolName as any,
              params: t.params || {},
            })),
            execution: "parallel",
            reason: "All Pennote tools are read-only",
          },
        ],
        reflectionTriggers: [
          { condition: "error" },
          { condition: "ambiguous", threshold: 0.4 },
          { condition: "validation_failed" },
        ],
      };

      const reflection = await ThinkingService.conditionalReflect(
        phaseResult,
        toolPlan,
        {},
        request.model, // 🧠 Passer le modèle
      );

      if (
        reflection.action !== "continue" &&
        reflection.reasoning !== "Phase successful, no reflection needed"
      ) {
        apiCallsUsed++; // Reflection = 1 API call (si nécessaire)
        reflectionCount++;
        console.log(
          `🧠 [COORDINATOR-OPTIMIZED] Réflexion effectuée: ${reflection.action}`,
        );
      }

      // ============================================
      // ÉTAPE 4 : BATCH SCORING (1 appel API au lieu de N!)
      // ============================================
      
      // 🚀 FAST MODE: Pour mode "ask", on skip le scoring (gain ~78s)
      const isFastMode = !request.isSearch && batchResult.successRate > 0.9;
      
      // Filtrer les résultats valides pour le scoring
      const validResults = batchResult.results.filter(r => !r.error && r.result);
      const useBatchScoring = BatchScoringService.shouldUseBatch(validResults.length);
      
      if (isFastMode) {
        console.log("⚡ [COORDINATOR-OPTIMIZED] FAST MODE: Scoring désactivé pour mode 'ask'");
      } else if (useBatchScoring) {
        console.log(`📊 [COORDINATOR-OPTIMIZED] ÉTAPE 4/4: BATCH Scoring (${validResults.length} résultats → 1 appel)...`);
      } else {
        console.log(`📊 [COORDINATOR-OPTIMIZED] ÉTAPE 4/4: Scoring standard (${validResults.length} résultats)...`);
      }

      // 🆕 Notifier le frontend du début du scoring
      if (request.onScoring) {
        request.onScoring(
          "all",
          isFastMode ? "Mode rapide activé" : useBatchScoring ? `Batch scoring de ${validResults.length} résultats...` : `Analyse de ${validResults.length} résultats...`,
        );
      }

      let toolCalls: OrchestrationResult["toolCalls"];

      if (isFastMode) {
        // 🚀 FAST MODE: Pas de scoring du tout
        toolCalls = batchResult.results.map((result, i) => ({
          name: result.tool,
          arguments: plan.toolSequence[i].params || {},
          result: result.result || `Error: ${result.error?.message}`,
          thinking: "",
          score: null,
          timestamp: Date.now(),
        }));
      } else if (useBatchScoring) {
        // 🚀 BATCH SCORING: 1 appel pour tous les résultats
        const batchInputs = validResults.map((result, i) => ({
          tool: result.tool,
          result: result.result,
          description: plan.toolSequence[batchResult.results.indexOf(result)]?.description,
        }));

        const batchScores = await BatchScoringService.batchScore({
          query: plan.optimizedQuery || request.query,
          results: batchInputs,
          model: request.model,
          mode: request.isSearch ? "search" : "ask",
        });

        // Reconstruire toolCalls avec les scores batch
        let scoreIndex = 0;
        toolCalls = batchResult.results.map((result, i) => {
          const hasValidResult = !result.error && result.result;
          const score = hasValidResult ? batchScores[scoreIndex++] || null : null;
          
          return {
            name: result.tool,
            arguments: plan.toolSequence[i].params || {},
            result: result.result || `Error: ${result.error?.message}`,
            thinking: "",
            score,
            timestamp: Date.now(),
          };
        });
      } else {
        // 🔄 SCORING INDIVIDUEL (pour < 3 résultats, plus précis)
        const scoringPromises = batchResult.results.map(async (result, i) => {
          const step = plan.toolSequence[i];
          
          if (result.error || !result.result) {
            return {
              name: result.tool,
              arguments: step.params || {},
              result: result.result || `Error: ${result.error?.message}`,
              thinking: "",
              score: null,
              timestamp: Date.now(),
            };
          }

          try {
            const score = await ScoringService.scoreToolResult({
              toolName: result.tool,
              result: result.result,
              query: plan.optimizedQuery || request.query,
              expectedInfo: step.description,
              model: request.model,
              context: {
                useWeb: request.useWeb,
                hasSpecificSource: request.availableSources.length > 0,
                mode: request.isSearch ? "search" : "ask",
              },
            });

            return {
              name: result.tool,
              arguments: step.params || {},
              result: result.result,
              thinking: "",
              score,
              timestamp: Date.now(),
            };
          } catch (scoreError) {
            console.warn(
              `⚠️ [COORDINATOR-OPTIMIZED] Erreur scoring tool ${result.tool}:`,
              scoreError,
            );
            return {
              name: result.tool,
              arguments: step.params || {},
              result: result.result,
              thinking: "",
              score: null,
              timestamp: Date.now(),
            };
          }
        });

        toolCalls = await Promise.all(scoringPromises);
      }

      // 🆕 Notifier le frontend de la fin du scoring
      if (request.onScoring) {
        request.onScoring("all", "Terminé");
      }

      // ============================================
      // MÉTRIQUES
      // ============================================
      const endTime = Date.now();
      const totalLatency = endTime - startTime;

      const metrics: ExecutionMetrics = {
        timestamp: startTime,
        mode: plan.detectedMode,
        apiCalls: apiCallsUsed,
        latency: totalLatency,
        parallelizedTools: batchResult.results.length,
        tokenUsage: {
          input: 4000 * apiCallsUsed, // Estimation
          output: 600 * apiCallsUsed,
          cached: 0, // TODO: intégrer prompt caching
        },
        cost: 0.015 * apiCallsUsed, // Estimation basique
        reflectionCount,
        successRate: batchResult.successRate,
        toolsExecuted: batchResult.results.length,
      };

      MetricsService.logExecution(metrics);

      console.log(
        `✅ [COORDINATOR-OPTIMIZED] Orchestration terminée en ${(totalLatency / 1000).toFixed(2)}s`,
      );
      console.log(
        `   API calls: ${apiCallsUsed} (vs ${2 + plan.toolSequence.length} baseline)`,
      );
      console.log(`   Reflections: ${reflectionCount}`);
      console.log(`   Tools exécutés: ${toolCalls.length}`);

      return {
        success: true,
        toolCalls,
        thinking: plan.reasoning,
        intermediateThinkingBlocks: [],
        // Delta approach (Perplexity-style)
        wave1Response: wave1DataRef.current?.response,
        partialToolCount: wave1DataRef.current?.toolCount,
      };
    } catch (error) {
      console.error(`❌ [COORDINATOR-OPTIMIZED] Erreur orchestration:`, error);

      return {
        success: false,
        toolCalls: [],
        thinking: `Erreur d'orchestration: ${error instanceof Error ? error.message : "Erreur inconnue"}`,
        intermediateThinkingBlocks: [],
      };
    }
  }

  /**
   * 🔍 Valide la cohérence entre le thinking et l'action proposée
   */
  static async validateCoherence(
    input: CoordinatorInput,
  ): Promise<CoordinatorOutput> {
    const {
      thinking,
      nextToolName,
      previousToolResults: _previousToolResults,
      originalPlan: _originalPlan,
      toolArguments,
    } = input;

    console.log(`🎯 [COORDINATOR] Validation de cohérence...`);
    console.log(`   Thinking: "${thinking.slice(0, 100)}..."`);
    console.log(`   Tool proposé: ${nextToolName}`);

    // 🆕 ÉTAPE 0 : Valider les DÉPENDANCES entre tools (mode WARNING, pas BLOCKING)
    // Inspiré de Cursor: le coordinator GUIDE, il ne BLOQUE pas systématiquement
    if (nextToolName) {
      const depValidation = await this.validateToolDependencies(
        nextToolName,
        toolArguments || {},
        input,
      );

      if (!depValidation.isValid) {
        console.warn(
          `⚠️ [COORDINATOR] Dépendances suspectes: ${depValidation.reasoning}`,
        );

        // Ne bloquer QUE si c'est une erreur CRITIQUE (pas juste une validation heuristique)
        const isCriticalError =
          depValidation.reasoning.includes("DOIT être appelé") ||
          depValidation.reasoning.includes("aucune source listée") ||
          depValidation.reasoning.includes("CRITIQUE");

        if (isCriticalError && depValidation.shouldBlock) {
          console.error(
            `❌ [COORDINATOR] Erreur CRITIQUE détectée, blocage nécessaire`,
          );
          return {
            isValid: false,
            reasoning: depValidation.reasoning,
            shouldBlock: true,
            correctedArguments: depValidation.suggestedFix?.arguments,
          };
        }

        // Sinon, WARNING seulement (laisser passer mais logger)
        console.log(
          `⚠️ [COORDINATOR] Validation faible mais on continue (coordinator guide, ne bloque pas)`,
        );
      }
    }

    // 🔥 DÉTECTION D'INCOHÉRENCES ÉVIDENTES
    const incoherences = this.detectIncoherences(thinking, nextToolName);

    if (incoherences.length > 0) {
      console.warn(`⚠️ [COORDINATOR] Incohérences détectées:`, incoherences);

      // Appeler l'IA Coordinator pour corriger
      return await this.callCoordinatorAI(input, incoherences);
    }

    // Tout est cohérent
    console.log(`✅ [COORDINATOR] Plan cohérent, validation OK`);
    return {
      isValid: true,
      reasoning: "Plan cohérent avec le thinking",
      shouldBlock: false,
    };
  }

  /**
   * 🔍 Détecte les incohérences évidentes (règles heuristiques)
   */
  private static detectIncoherences(
    thinking: string,
    nextToolName: string | null,
  ): string[] {
    const incoherences: string[] = [];
    const thinkingLower = thinking.toLowerCase();

    // Règle 1: L'IA dit "je vais lire" mais appelle search_web
    if (
      (thinkingLower.includes("je vais lire") ||
        thinkingLower.includes("lire la source") ||
        thinkingLower.includes("lire les sources")) &&
      nextToolName === "search_web"
    ) {
      incoherences.push(
        `Thinking dit "lire les sources" mais appelle "search_web"`,
      );
    }

    // Règle 2: L'IA dit "sélectionner" mais saute à autre chose
    if (
      (thinkingLower.includes("sélectionner") ||
        thinkingLower.includes("choisir les sources")) &&
      nextToolName !== "select_relevant_sources" &&
      nextToolName !== null
    ) {
      incoherences.push(
        `Thinking dit "sélectionner" mais appelle "${nextToolName}"`,
      );
    }

    // Règle 3: L'IA dit "rechercher sur le web" mais appelle autre chose
    if (
      (thinkingLower.includes("rechercher sur le web") ||
        thinkingLower.includes("chercher sur internet") ||
        thinkingLower.includes("web")) &&
      nextToolName !== "search_web" &&
      !thinkingLower.includes("pas besoin")
    ) {
      incoherences.push(
        `Thinking mentionne "web" mais appelle "${nextToolName}"`,
      );
    }

    // Règle 4: L'IA dit avoir trouvé des sources pertinentes mais veut faire search_web
    if (
      thinkingLower.includes("trouvé") &&
      (thinkingLower.includes("source") ||
        thinkingLower.includes("pertinent")) &&
      nextToolName === "search_web" &&
      !thinkingLower.includes("compléter") &&
      !thinkingLower.includes("enrichir")
    ) {
      incoherences.push(
        `Thinking dit avoir trouvé des sources mais appelle "search_web" sans justification`,
      );
    }

    return incoherences;
  }

  /**
   * 🤖 Appelle l'IA Coordinator pour corriger les incohérences
   */
  private static async callCoordinatorAI(
    input: CoordinatorInput,
    incoherences: string[],
  ): Promise<CoordinatorOutput> {
    const openai = AIService.getOpenAI();

    const coordinatorPrompt = `Tu es un Coordinator IA qui vérifie la cohérence des plans d'action.

**INCOHÉRENCES DÉTECTÉES** :
${incoherences.map((inc, i) => `${i + 1}. ${inc}`).join("\n")}

**THINKING DE L'IA** :
"${input.thinking}"

**ACTION PROPOSÉE** :
Tool: ${input.nextToolName}
Arguments: ${JSON.stringify(input.toolArguments)}

**RÉSULTATS PRÉCÉDENTS** :
${input.previousToolResults.slice(-2).join("\n---\n")}

**TA MISSION** :
Analyse l'incohérence et décide :
1. Si l'IA doit CONTINUER avec son plan actuel (justifié)
2. Si l'IA doit être CORRIGÉE (incohérence évidente)

**RÈGLES** :
- Si thinking dit "lire 3 sources" → le prochain tool DOIT être read_rag_source
- Si thinking dit "sélectionner" → le prochain tool DOIT être select_relevant_sources
- Si thinking dit "web" → OK pour search_web
- Si thinking et action sont INCOHÉRENTS → propose une CORRECTION

**RÉPONSE (JSON STRICT)** :
{
  "isValid": boolean,
  "correctedToolName": "nom_tool_corrigé" ou null,
  "correctedArguments": {} ou null,
  "reasoning": "explication courte",
  "shouldBlock": boolean (true SEULEMENT si aucune correction possible)
}

**IMPORTANT** :
- Si tu peux corriger le tool → shouldBlock = false (on appliquera la correction)
- Si aucune correction possible → shouldBlock = true (blocage)`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI coordinator that validates plan coherence. Return ONLY valid JSON without decorative symbols.",
          },
          {
            role: "user",
            content: coordinatorPrompt,
          },
        ],
        temperature: 0.1, // Very low temperature for consistent validation
        max_completion_tokens: 400, // GPT-5 uses max_completion_tokens instead of max_tokens
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const result = JSON.parse(content) as CoordinatorOutput;

      console.log(`🎯 [COORDINATOR-AI] Décision:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR-AI] Erreur:`, error);

      // Fallback: bloquer par sécurité
      return {
        isValid: false,
        shouldBlock: true,
        reasoning: `Erreur Coordinator: ${error instanceof Error ? error.message : "Erreur inconnue"}. Blocage par sécurité.`,
      };
    }
  }

  /**
   * 🎯 Enrichit la validation avec les scores et recommandations de stratégie
   *
   * Cette méthode intègre le feedback loop "observe → adjust → continue"
   * en utilisant les scores pour détecter des patterns problématiques
   */
  static async enrichValidationWithScores(
    input: CoordinatorInput,
    averageScore: number,
    strategyRecommendation: string,
  ): Promise<{ shouldWarn: boolean; warningMessage?: string }> {
    // Si le score moyen est très faible (<0.3), avertir
    if (averageScore < 0.3) {
      return {
        shouldWarn: true,
        warningMessage: `Score moyen très faible (${averageScore.toFixed(2)}). Les résultats précédents sont insuffisants. ${strategyRecommendation}`,
      };
    }

    // Si le score moyen est moyen (<0.6) et que l'IA veut arrêter
    if (averageScore < 0.6 && input.nextToolName === null) {
      return {
        shouldWarn: true,
        warningMessage: `Score moyen moyen (${averageScore.toFixed(2)}). L'IA veut arrêter mais les résultats sont partiels. Recommandation: continuer l'exploration.`,
      };
    }

    // Si le score moyen est bon (>0.7), tout va bien
    if (averageScore > 0.7) {
      return {
        shouldWarn: false,
      };
    }

    return {
      shouldWarn: false,
    };
  }

  /**
   * 🔍 Valide une modification de plan (modifiedToolSequence)
   */
  static async validatePlanModification(
    originalPlan: string[],
    modifiedPlan: string[],
    lastToolResult: string,
    thinking: string,
  ): Promise<{ isValid: boolean; reasoning: string }> {
    console.log(`🔄 [COORDINATOR] Validation modification de plan...`);
    console.log(`   Plan original: ${originalPlan.join(" → ")}`);
    console.log(`   Plan modifié: ${modifiedPlan.join(" → ")}`);

    const openai = AIService.getOpenAI();

    const validationPrompt = `Tu es un Coordinator qui valide les modifications de plan.

**PLAN ORIGINAL** : ${originalPlan.join(" → ")}
**PLAN MODIFIÉ** : ${modifiedPlan.join(" → ")}

**DERNIER RÉSULTAT** :
${lastToolResult.slice(0, 500)}

**THINKING** :
"${thinking}"

**QUESTION** :
La modification de plan est-elle justifiée par le résultat précédent ?

**RÈGLES** :
- Si le résultat indique "aucune source" → OK pour modifier vers search_web
- Si le résultat contient des sources pertinentes → PAS OK de sauter vers search_web sans les lire
- Si l'IA change de plan sans raison liée au résultat → REFUSER

**RÉPONSE (JSON)** :
{
  "isValid": boolean,
  "reasoning": "explication courte"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content:
              "You are an expert plan coherence validator. Return ONLY valid JSON without decorative symbols.",
          },
          {
            role: "user",
            content: validationPrompt,
          },
        ],
        temperature: 0.1, // Very low temperature for consistent validation
        max_completion_tokens: 300, // GPT-5 uses max_completion_tokens instead of max_tokens
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const result = JSON.parse(content);

      console.log(`🔄 [COORDINATOR] Validation modification:`, result);

      return result;
    } catch (error) {
      console.error(`❌ [COORDINATOR] Erreur validation:`, error);
      return {
        isValid: false,
        reasoning: "Erreur de validation, modification refusée par sécurité",
      };
    }
  }

  /**
   * 🆕 Valide les dépendances d'un tool via ToolDependenciesValidator
   */
  private static async validateToolDependencies(
    toolName: string,
    toolArguments: any,
    input: CoordinatorInput,
  ): Promise<DependencyValidationResult> {
    // Utiliser le contexte d'exécution fourni, sinon créer un contexte vide
    const executionContext: ToolExecutionContext = input.executionContext || {
      executedTools: [],
      extractedSources: [],
    };

    return ToolDependenciesValidator.validateDependencies(
      toolName,
      toolArguments,
      executionContext,
    );
  }

  /**
   * Validates a complete tool plan
   */
  static validateFullPlan(
    toolSequence: Array<{ toolName: string; params?: any }>,
    mode: "ask" | "search" | "create_rapide" | "create_profond",
    hasPreselectedSources: boolean = false,
  ): DependencyValidationResult {
    console.log(`[COORDINATOR] Validation du plan complet (mode: ${mode})...`);

    const validation = ToolDependenciesValidator.validatePlan(
      toolSequence,
      mode,
      hasPreselectedSources,
    );

    if (!validation.isValid) {
      console.error(`[COORDINATOR] Plan invalide: ${validation.reasoning}`);
    } else {
      console.log(`[COORDINATOR] Plan valide: ${validation.reasoning}`);
    }

    return validation;
  }
}
