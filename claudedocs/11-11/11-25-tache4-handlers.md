# Tâche 4 : Mettre à jour les handlers pour utiliser CoordinatorService

## 🎯 Objectif
Modifier les 3 handlers (`askStream`, `createStream`, `searchStream`) pour qu'ils appellent le nouveau `CoordinatorService.orchestrate()` au lieu de `Phase1Service.executeMultiPhaseFunctionCalling()`.

## 📋 Étapes à suivre

### 1. Mettre à jour askStream.ts

**Fichier** : `src/controllers/assistant/handlers/askStream.ts`

**Modifications** :

1. **Import** : Ajouter l'import du Coordinator
```typescript
import { CoordinatorService, type OrchestrationRequest } from '../../../services/ai/functionCalling/index.js';
```

2. **Remplacer l'appel Phase1** (ligne ~100-150)

**Avant** :
```typescript
const result = await Phase1Service.executeMultiPhaseFunctionCalling({
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  isSearch: false,
  useWeb,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
});
```

**Après** :
```typescript
const orchestrationRequest: OrchestrationRequest = {
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  useWeb,
  isSearch: false,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
};

const result = await CoordinatorService.orchestrate(orchestrationRequest);
```

### 2. Mettre à jour searchStream.ts

**Fichier** : `src/controllers/assistant/handlers/searchStream.ts`

**Modifications** :

1. **Import** : Ajouter l'import du Coordinator
```typescript
import { CoordinatorService, type OrchestrationRequest } from '../../../services/ai/functionCalling/index.js';
```

2. **Remplacer l'appel Phase1** (ligne ~100-150)

**Avant** :
```typescript
const result = await Phase1Service.executeMultiPhaseFunctionCalling({
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  isSearch: true,
  useWeb,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
});
```

**Après** :
```typescript
const orchestrationRequest: OrchestrationRequest = {
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  useWeb,
  isSearch: true,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
};

const result = await CoordinatorService.orchestrate(orchestrationRequest);
```

### 3. Mettre à jour createStream.ts

**Fichier** : `src/controllers/assistant/handlers/createStream.ts`

**Modifications** :

1. **Import** : Ajouter l'import du Coordinator
```typescript
import { CoordinatorService, type OrchestrationRequest } from '../../../services/ai/functionCalling/index.js';
```

2. **Remplacer l'appel Phase1** (ligne ~100-150)

**Avant** :
```typescript
const result = await Phase1Service.executeMultiPhaseFunctionCalling({
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  isSearch: false,
  useWeb,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
});
```

**Après** :
```typescript
const orchestrationRequest: OrchestrationRequest = {
  query: userMessage,
  workspaceId,
  userId,
  availableSources,
  useWeb,
  isSearch: false,
  systemPrompt,
  onThinking,
  onToolCall,
  onToolResult,
  onIntermediateThinking
};

const result = await CoordinatorService.orchestrate(orchestrationRequest);
```

### 4. Vérifier la compatibilité des retours

**Important** : `OrchestrationResult` doit être compatible avec l'ancien retour de Phase1.

Vérifier que les 3 handlers utilisent correctement :
- `result.toolCalls` (array)
- `result.thinking` (string)
- `result.intermediateThinkingBlocks` (array)

Si besoin, ajuster les types dans les handlers.

## ✅ Critères de validation

- [ ] askStream.ts modifié pour utiliser CoordinatorService.orchestrate()
- [ ] searchStream.ts modifié pour utiliser CoordinatorService.orchestrate()
- [ ] createStream.ts modifié pour utiliser CoordinatorService.orchestrate()
- [ ] Imports corrects dans les 3 fichiers
- [ ] Types OrchestrationRequest utilisés correctement
- [ ] Compatibilité avec OrchestrationResult vérifiée
- [ ] Compilation TypeScript sans erreur (`npx tsc --noEmit`)
- [ ] Test manuel : créer une conversation et vérifier que les tools sont appelés

## ⚠️ Ne PAS faire dans cette tâche

- ❌ Ne pas supprimer Phase1Service (garder temporairement)
- ❌ Ne pas toucher à la logique métier des handlers
- ❌ Ne pas modifier PlannerService ou ExecutorService
- ❌ Ne pas faire de tests unitaires pour l'instant

## 📝 Notes

- Cette tâche dépend des Tâches 1, 2 et 3
- C'est la migration effective vers la nouvelle architecture
- Phase1Service reste dans le code mais n'est plus appelé
- On pourra le supprimer dans la Tâche 5 après validation

## 🔍 Vérification rapide

Après modification, vérifier dans chaque handler :
```typescript
// Doit apparaître :
import { CoordinatorService, type OrchestrationRequest } from '...';

// Doit apparaître :
const orchestrationRequest: OrchestrationRequest = { ... };
const result = await CoordinatorService.orchestrate(orchestrationRequest);

// Ne doit PLUS apparaître :
Phase1Service.executeMultiPhaseFunctionCalling
```
