# Tâche 3 : Renforcer CoordinatorService en Orchestrateur

## 🎯 Objectif
Transformer le `CoordinatorService` en **orchestrateur principal** qui coordonne Planner, Executor et Scorer.

## 📋 Étapes à suivre

### 1. Ajouter la méthode principale `orchestrate()`

Dans `src/services/ai/functionCalling/coordinator.service.ts`, ajouter :

```typescript
import { PlannerService, type PlanRequest } from './planner.service.js';
import { ExecutorService, type ExecutionContext, type ExecutionStep } from './executor.service.js';
import { ScoringService } from './scoring.service.js';

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
}

export interface OrchestrationResult {
  success: boolean;
  toolCalls: Array<{
    name: string;
    arguments: any;
    result: string;
    thinking?: string;
    score?: any;
  }>;
  thinking: string;
  intermediateThinkingBlocks: any[];
}

export class CoordinatorService {
  /**
   * 🎯 ORCHESTRATEUR PRINCIPAL (nouvelle méthode)
   * Coordonne Planner → Executor → Scorer en boucle
   */
  static async orchestrate(
    request: OrchestrationRequest
  ): Promise<OrchestrationResult> {
    console.log('🎯 [COORDINATOR] Démarrage orchestration');

    // ÉTAPE 1 : PLANNING (via PlannerService)
    const planRequest: PlanRequest = {
      query: request.query,
      availableSources: request.availableSources,
      workspaceId: request.workspaceId,
      userId: request.userId,
      isSearch: request.isSearch,
      useWeb: request.useWeb,
      systemPrompt: request.systemPrompt
    };

    const plan = await PlannerService.generatePlan(planRequest);

    console.log(`🎯 [COORDINATOR] Plan généré: ${plan.toolSequence.length} tools`);

    // ÉTAPE 2 : VALIDATION DU PLAN
    const detectedMode = ToolDependenciesValidator.detectMode(request.query, request.isSearch);
    const planValidation = this.validateFullPlan(
      plan.toolSequence.map(t => ({ toolName: t.toolName, params: t.params })),
      detectedMode
    );

    if (!planValidation.isValid) {
      console.error(`❌ [COORDINATOR] Plan invalide: ${planValidation.reasoning}`);
      return {
        success: false,
        toolCalls: [],
        thinking: plan.reasoning,
        intermediateThinkingBlocks: []
      };
    }

    // ÉTAPE 3 : BOUCLE D'EXÉCUTION
    const toolCalls: any[] = [];
    const intermediateThinkingBlocks: any[] = [];
    let executionContext: ExecutionContext = {
      userId: request.userId,
      workspaceId: request.workspaceId,
      query: plan.optimizedQuery || request.query,
      executedTools: [],
      extractedSources: request.availableSources,
      currentIteration: 0,
      maxIterations: plan.totalIterations
    };

    for (let i = 0; i < plan.toolSequence.length; i++) {
      const step = plan.toolSequence[i];

      console.log(`🎯 [COORDINATOR] Exécution step ${i + 1}/${plan.toolSequence.length}: ${step.toolName}`);

      try {
        // Exécuter le step via ExecutorService
        const result = await ExecutorService.executeStep(
          step,
          executionContext,
          {
            onIntermediateThinking: request.onIntermediateThinking,
            onToolCall: request.onToolCall,
            onToolResult: request.onToolResult
          }
        );

        // Mettre à jour le contexte
        executionContext.executedTools.push({
          name: result.toolName,
          arguments: result.arguments,
          result: result.result
        });

        if (result.extractedSources) {
          executionContext.extractedSources.push(...result.extractedSources);
        }

        executionContext.currentIteration = i + 1;

        // Score le résultat
        const score = await ScoringService.scoreToolResult({
          toolName: result.toolName,
          result: result.result,
          query: executionContext.query
        });

        toolCalls.push({
          name: result.toolName,
          arguments: result.arguments,
          result: result.result,
          thinking: result.thinking,
          score
        });

        // Vérifier si on doit continuer
        if (!result.shouldContinue) {
          console.log(`🎯 [COORDINATOR] Arrêt demandé par l'executor`);
          break;
        }

        // Vérifier si le score est trop faible
        if (score.overallScore < 0.3) {
          console.warn(`⚠️ [COORDINATOR] Score très faible (${score.overallScore}), mais on continue`);
        }

      } catch (error) {
        console.error(`❌ [COORDINATOR] Erreur step ${i + 1}:`, error);
        // Continuer malgré l'erreur (ne pas tout casser)
      }
    }

    console.log(`✅ [COORDINATOR] Orchestration terminée: ${toolCalls.length} tools exécutés`);

    return {
      success: true,
      toolCalls,
      thinking: plan.reasoning,
      intermediateThinkingBlocks
    };
  }

  // ... garder les méthodes existantes (validateCoherence, etc.)
}
```

### 2. Garder les méthodes existantes
- ✅ `validateCoherence()` - déjà existante
- ✅ `validatePlanModification()` - déjà existante
- ✅ `validateFullPlan()` - déjà existante
- ✅ `enrichValidationWithScores()` - déjà existante

### 3. Exports
Ajouter dans `src/services/ai/functionCalling/index.ts` :
```typescript
export type { OrchestrationRequest, OrchestrationResult } from './coordinator.service.js';
```

## ✅ Critères de validation

- [ ] Méthode `orchestrate()` ajoutée au CoordinatorService
- [ ] Appelle PlannerService.generatePlan()
- [ ] Valide le plan avec validateFullPlan()
- [ ] Boucle d'exécution avec ExecutorService.executeStep()
- [ ] Scoring des résultats avec ScoringService
- [ ] Gestion des erreurs sans tout casser
- [ ] Exports ajoutés dans index.ts
- [ ] Compilation TypeScript sans erreur (`npx tsc --noEmit`)

## ⚠️ Ne PAS faire dans cette tâche
- ❌ Ne pas supprimer les méthodes existantes
- ❌ Ne pas modifier phase1.service.ts
- ❌ Ne pas toucher aux handlers encore
- ❌ Ne pas faire de tests pour l'instant

## 📝 Notes
- Le Coordinator devient LE point d'entrée principal
- Il orchestre tout : Planner → Executor → Scorer
- Cette tâche dépend des Tâches 1 et 2
