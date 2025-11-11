# Tâche 2 : Créer ExecutorService (Intermediate Thinking)

## 🎯 Objectif
Extraire la logique d'**exécution des tools** (Intermediate Thinking) de `phase1.service.ts` dans un service dédié `executor.service.ts`.

## 📋 Étapes à suivre

### 1. Créer le nouveau fichier
- Créer : `src/services/ai/functionCalling/executor.service.ts`

### 2. Créer les interfaces

```typescript
import { AIService } from "../base.js";
import { ToolExecutor, type ToolContext } from "../tools/executors.js";
import { parseJSONFromStream } from "./utils/jsonParser.js";
import { isIntermediateThinkingOutput } from "../../types/ragThinking.js";

export interface ExecutionStep {
  toolName: string;
  description: string;
  params?: any;
}

export interface ExecutionContext {
  userId: string;
  workspaceId: string;
  query: string;
  executedTools: Array<{
    name: string;
    arguments: any;
    result: string;
  }>;
  extractedSources: Array<{
    id: string;
    title: string;
    sourceType: string;
  }>;
  currentIteration: number;
  maxIterations: number;
}

export interface ExecutionResult {
  toolName: string;
  arguments: any;
  result: string;
  thinking: string;
  extractedSources?: Array<{
    id: string;
    title: string;
    sourceType: string;
  }>;
  success: boolean;
  shouldContinue: boolean;
}

export class ExecutorService {
  /**
   * Exécute un step du plan (Intermediate Thinking + Tool Call)
   */
  static async executeStep(
    step: ExecutionStep,
    context: ExecutionContext,
    callbacks: {
      onIntermediateThinking?: (chunk: string) => void;
      onToolCall?: (toolName: string, args: any) => void;
      onToolResult?: (toolName: string, result: string) => void;
    }
  ): Promise<ExecutionResult> {
    // TODO: Copier la logique Intermediate Thinking depuis phase1.service.ts
    // Lignes ~800-1200 de phase1.service.ts
    // - Construction du prompt Intermediate Thinking
    // - Appel GPT-4o pour générer les arguments
    // - Parsing du JSON avec arguments
    // - Exécution du tool via ToolExecutor
    // - Extraction des sources si list_available_sources
  }

  /**
   * Extrait les sources d'un résultat de tool
   */
  private static extractSourcesFromResult(
    toolName: string,
    result: string
  ): Array<{ id: string; title: string; sourceType: string }> {
    // TODO: Copier depuis phase1.service.ts ligne ~650-680
  }
}
```

### 3. Ce qu'il faut extraire de phase1.service.ts

**Lignes approximatives à copier** :
- Ligne 800-1050 : Construction prompt Intermediate Thinking
- Ligne 1100-1120 : Appel GPT-4o + streaming
- Ligne 1127-1300 : Parsing JSON + exécution tool
- Ligne 650-680 : Extraction sources depuis résultats

**Important** :
- Garder l'appel GPT-4o (température 0.2)
- Garder la gestion des callbacks (onIntermediateThinking, etc.)
- Conserver l'extraction des sources pour list_available_sources
- Gérer le shouldContinue (si modifiedToolSequence)

### 4. Exports
Ajouter dans `src/services/ai/functionCalling/index.ts` :
```typescript
export { ExecutorService } from './executor.service.js';
export type { ExecutionStep, ExecutionContext, ExecutionResult } from './executor.service.js';
```

## ✅ Critères de validation

- [ ] Fichier `executor.service.ts` créé
- [ ] Classe `ExecutorService` avec méthode `executeStep()`
- [ ] Retourne un objet `ExecutionResult` structuré
- [ ] Gestion des callbacks (streaming)
- [ ] Extraction des sources fonctionnelle
- [ ] Exports ajoutés dans index.ts
- [ ] Compilation TypeScript sans erreur (`npx tsc --noEmit`)

## ⚠️ Ne PAS faire dans cette tâche
- ❌ Ne pas toucher à phase1.service.ts encore
- ❌ Ne pas modifier les handlers (askStream, etc.)
- ❌ Ne pas toucher au Coordinator
- ❌ Ne pas faire de tests pour l'instant

## 📝 Notes
- Cette tâche dépend de la Tâche 1 (PlannerService)
- Garder phase1.service.ts intact
- On l'utilisera encore temporairement
