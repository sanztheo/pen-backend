# Architecture Refactoring Plan - Cursor-Style Agent Hierarchy

## 🎯 Objectif
Refactoriser l'architecture actuelle pour suivre les bonnes pratiques de Cursor :
- **Coordinator** = Chef d'orchestre (priorité absolue)
- **Planner** = Générateur de plan (important mais remplaçable)
- **Executor** = Exécuteur de tools (guidé par coordinator)
- **Scorer** = Juge de qualité (bonus, pas critique)

## 📊 Architecture actuelle (problématique)

```
Phase1Service (1500+ lignes)
├─ First Thinking (planning)
├─ Intermediate Thinking (execution)
├─ Tool execution loop
├─ Strategy adjustment
└─ Scoring integration

CoordinatorService
├─ Validation passive (après génération)
└─ Pas d'orchestration active

ScoringService
└─ Évaluation après coup
```

**Problèmes** :
- ❌ Phase1Service fait TOUT (violation SRP)
- ❌ Coordinator valide mais n'orchestre pas
- ❌ Pas de séparation claire Planning vs Execution
- ❌ Difficile à tester et maintenir

## ✅ Architecture recommandée (Cursor-style)

```
CoordinatorService (ORCHESTRATEUR - le chef)
├─ Reçoit la requête utilisateur
├─ Appelle PlannerService → génère plan JSON
├─ Valide le plan (nombre tools, dépendances)
├─ Boucle d'exécution :
│  ├─ Pour chaque step du plan :
│  │  ├─ Appelle ExecutorService → génère args + exécute tool
│  │  ├─ Appelle ScoringService → évalue qualité
│  │  └─ Décide : continuer / ajuster plan / arrêter
│  └─ Gère les erreurs et relances
└─ Retourne résultat final

PlannerService (PLANNER)
├─ Génère le First Thinking (plan JSON)
├─ Détecte le mode (ask/search/create)
├─ Propose séquence de tools
├─ Optimise la query
└─ Format : { plan: { toolSequence, optimizedQuery, reasoning } }

ExecutorService (EXECUTOR)
├─ Génère Intermediate Thinking pour chaque tool
├─ Extrait arguments du thinking
├─ Exécute le tool via ToolExecutor
├─ Gère extractedSources
└─ Retourne : { result, sources, thinking }

ScoringService (JUDGE)
├─ Évalue qualité des résultats
├─ Suggère ajustements stratégiques
├─ Détecte patterns problématiques
└─ Retourne : { score, suggestions, shouldContinue }
```

## 🔄 Plan de migration

### Phase 1 : Extraction PlannerService ✅ (peut se faire en premier)
1. Créer `src/services/ai/functionCalling/planner.service.ts`
2. Extraire la logique First Thinking de Phase1Service
3. Méthode principale : `generatePlan(query, sources, mode)`
4. Retour : Plan JSON structuré

### Phase 2 : Extraction ExecutorService ✅ (dépend de Phase 1)
1. Créer `src/services/ai/functionCalling/executor.service.ts`
2. Extraire la boucle d'exécution de Phase1Service
3. Méthode principale : `executeStep(step, context)`
4. Retour : Résultat + sources + thinking

### Phase 3 : Renforcement CoordinatorService 🎯 (CRITIQUE)
1. Transformer Coordinator en orchestrateur principal
2. Ajouter méthodes :
   - `orchestrate(request)` → point d'entrée principal
   - `validatePlan(plan)` → validation stricte
   - `handleError(error, context)` → gestion erreurs
   - `adjustStrategy(results)` → décisions adaptatives
3. Le Coordinator devient le SEUL point d'entrée

### Phase 4 : Mise à jour des handlers
1. `askStream.ts` : Appeler CoordinatorService.orchestrate()
2. `createStream.ts` : Appeler CoordinatorService.orchestrate()
3. `searchStream.ts` : Appeler CoordinatorService.orchestrate()
4. Supprimer les appels directs à Phase1Service

### Phase 5 : Cleanup et tests
1. Supprimer ou déprécier Phase1Service
2. Tests unitaires pour chaque service
3. Tests d'intégration du flux complet
4. Documentation mise à jour

## 📝 Interfaces recommandées

### PlannerService
```typescript
interface PlanRequest {
  query: string;
  availableSources: Source[];
  workspaceId: string;
  userId: string;
  mode: 'ask' | 'search' | 'create_rapide' | 'create_profond';
  useWeb: boolean;
}

interface Plan {
  toolSequence: Array<{
    step: number;
    toolName: string;
    description: string;
    params?: any;
  }>;
  optimizedQuery: string;
  reasoning: string;
  totalIterations: number;
}

class PlannerService {
  static async generatePlan(request: PlanRequest): Promise<Plan>;
}
```

### ExecutorService
```typescript
interface ExecutionStep {
  toolName: string;
  params?: any;
  description: string;
}

interface ExecutionContext {
  userId: string;
  workspaceId: string;
  executedTools: ToolCallRecord[];
  extractedSources: Source[];
  currentIteration: number;
}

interface ExecutionResult {
  toolName: string;
  arguments: any;
  result: string;
  thinking: string;
  extractedSources?: Source[];
  success: boolean;
}

class ExecutorService {
  static async executeStep(
    step: ExecutionStep,
    context: ExecutionContext
  ): Promise<ExecutionResult>;
}
```

### CoordinatorService (renforcé)
```typescript
interface OrchestrationRequest {
  query: string;
  workspaceId: string;
  userId: string;
  availableSources: Source[];
  useWeb: boolean;
  isSearch: boolean;
  systemPrompt: string;
  onThinking?: (chunk: string) => void;
  onToolCall?: (tool: string, args: any) => void;
  onToolResult?: (tool: string, result: string) => void;
  onIntermediateThinking?: (chunk: string) => void;
}

interface OrchestrationResult {
  success: boolean;
  toolCalls: ToolCallRecord[];
  thinking: string;
  intermediateThinkingBlocks: IntermediateThinkingBlock[];
  finalAnswer?: string;
}

class CoordinatorService {
  // Point d'entrée principal (NOUVEAU)
  static async orchestrate(
    request: OrchestrationRequest
  ): Promise<OrchestrationResult>;

  // Méthodes existantes conservées
  static async validateCoherence(input: CoordinatorInput): Promise<CoordinatorOutput>;
  static async validatePlanModification(...): Promise<...>;
  static validateFullPlan(...): DependencyValidationResult;
}
```

## 🎯 Bénéfices attendus

### Maintenabilité
- ✅ Séparation claire des responsabilités (SRP)
- ✅ Services indépendants et testables
- ✅ Moins de couplage

### Performance
- ✅ Coordinator peut optimiser l'ordre d'exécution
- ✅ Parallélisation possible si Coordinator décide
- ✅ Meilleures décisions d'arrêt précoce

### Qualité
- ✅ Coordinator ultra strict = moins d'erreurs
- ✅ Plan validé AVANT exécution
- ✅ Gestion erreurs centralisée

### Debugging
- ✅ Logs structurés par service
- ✅ Traçabilité complète du flux
- ✅ Points d'arrêt clairs

## 🚨 Points d'attention

### Rétrocompatibilité
- Garder Phase1Service en mode "legacy" temporairement
- Migration progressive (pas de big bang)
- Tests de non-régression obligatoires

### Performance
- Coordinator ne doit PAS devenir un bottleneck
- Validation rapide (< 100ms par step)
- Pas d'appels IA dans le Coordinator (sauf cas critique)

### Complexité
- Ne pas sur-engineer
- Garder les interfaces simples
- Documentation claire obligatoire

## 📅 Timeline suggérée

- **Semaine 1** : Phase 1 (PlannerService) + tests
- **Semaine 2** : Phase 2 (ExecutorService) + tests
- **Semaine 3** : Phase 3 (Coordinator renforcé) + intégration
- **Semaine 4** : Phase 4-5 (Migration handlers + cleanup)

## 🔗 Références

- [Cursor Agent Planning](https://cursor.com/docs/agent/planning)
- [Cursor Learn Agents](https://cursor.com/learn/agents)
- ChatGPT recommendations sur l'importance du Coordinator

---

**Note** : Cette refactorisation est une amélioration de qualité, pas une urgence.
Le système actuel fonctionne, mais cette architecture le rendra plus robuste et maintenable.

**Commit actuel (e4e1410)** : Coordinator assoupli, prêt pour devenir orchestrateur principal.
