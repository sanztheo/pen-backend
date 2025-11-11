# Tâche 1 : Créer PlannerService (First Thinking)

## 🎯 Objectif
Extraire la logique de **planification** (First Thinking) de `phase1.service.ts` dans un service dédié `planner.service.ts`.

## 📋 Étapes à suivre

### 1. Créer le nouveau fichier
- Créer : `src/services/ai/functionCalling/planner.service.ts`

### 2. Extraire les types nécessaires
Copier depuis `phase1.service.ts` :
- Les interfaces liées au planning (si nécessaire)
- Les types de retour du First Thinking

### 3. Créer la classe PlannerService

```typescript
import { AIService } from "../base.js";
import { ToolDependenciesValidator } from "./toolDependencies.js";

export interface PlanRequest {
  query: string;
  availableSources: Array<{
    id: string;
    title: string;
    type: string;
  }>;
  workspaceId: string;
  userId: string;
  isSearch: boolean;
  useWeb: boolean;
  systemPrompt?: string;
}

export interface ToolStep {
  step: number;
  toolName: string;
  description: string;
  params?: any;
}

export interface Plan {
  toolSequence: ToolStep[];
  optimizedQuery: string;
  reasoning: string;
  totalIterations: number;
}

export class PlannerService {
  /**
   * Génère un plan d'exécution (First Thinking)
   */
  static async generatePlan(request: PlanRequest): Promise<Plan> {
    // TODO: Copier la logique First Thinking depuis phase1.service.ts
    // Lignes ~78-450 de phase1.service.ts
    // - Détection du mode (ask/search/create)
    // - Construction du prompt First Thinking
    // - Appel GPT-4o pour générer le plan JSON
    // - Parsing et validation du plan
    // - Validation avec ToolDependenciesValidator.validatePlan()
  }
}
```

### 4. Ce qu'il faut extraire de phase1.service.ts

**Lignes approximatives à copier** :
- Ligne 62-68 : Détection du mode et limites tools
- Ligne 78-384 : Construction du prompt First Thinking
- Ligne 386-420 : Appel OpenAI + streaming
- Ligne 421-500 : Parsing et validation du plan

**Important** :
- Garder l'appel GPT-4o (pas mini)
- Garder la température 0.2
- Garder les prompts sans emojis
- Conserver la validation stricte du nombre de tools

### 5. Exports
Ajouter dans `src/services/ai/functionCalling/index.ts` :
```typescript
export { PlannerService } from './planner.service.js';
export type { PlanRequest, Plan, ToolStep } from './planner.service.js';
```

## ✅ Critères de validation

- [ ] Fichier `planner.service.ts` créé
- [ ] Classe `PlannerService` avec méthode `generatePlan()`
- [ ] Retourne un objet `Plan` structuré
- [ ] Validation du plan avec `ToolDependenciesValidator`
- [ ] Exports ajoutés dans index.ts
- [ ] Compilation TypeScript sans erreur (`npx tsc --noEmit`)

## ⚠️ Ne PAS faire dans cette tâche
- ❌ Ne pas toucher à phase1.service.ts encore
- ❌ Ne pas modifier les handlers (askStream, etc.)
- ❌ Ne pas toucher à ExecutorService
- ❌ Ne pas faire de tests pour l'instant

## 📝 Notes
- Garder phase1.service.ts intact pour l'instant
- On refactorisera progressivement
- Cette tâche est JUSTE l'extraction du planning
