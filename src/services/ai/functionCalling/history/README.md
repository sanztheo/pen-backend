# 🧠 Conversation History System

Système de gestion d'historique pour les agents multi-agents avec compression automatique.

## 📋 Vue d'ensemble

Ce système permet de maintenir un contexte de conversation entre les requêtes utilisateur en :
- Stockant les messages utilisateur (avec paramètres web, sources)
- Stockant les réponses AI (thinking, outils utilisés, réponse finale)
- Compressant automatiquement l'historique quand il dépasse 200k tokens
- Injectant l'historique dans le brain (PlannerService) pour maintenir le contexte

## 🔥 Flux de fonctionnement

### Flux sans compression (< 200k tokens)

```
User : "Parle moi de math", useWeb : true, source : "Pythagore,Cosinus"
AI :
  First thinking → tools → réponse
---

User : "Approfondis sil te plait"
AI :
  Historique précédent (request, first thinking, tools, réponse)
    ↓
  First thinking (+ historique) → tools → réponse
```

### Flux avec compression (> 200k tokens)

```
User : "Approfondis sil te plait"
AI :
  GPT-4o-mini (Historique complet → compact en 3-5k tokens)
    ↓ Reset Contexte Historique
  First thinking (+ historique compact de GPT-4o-mini) → Tools → Réponse
```

## 🗂️ Architecture

### Services

#### 1. **ConversationHistoryService**
Gère le stockage et la récupération de l'historique.

```typescript
// Ajouter un message utilisateur
ConversationHistoryService.addUserMessage(
  userId,
  workspaceId,
  "Parle moi de math",
  {
    web: true,
    all: false,
    sources: [{ id: "1", title: "Pythagore", type: "PDF" }],
  }
);

// Ajouter une réponse AI
ConversationHistoryService.addAIMessage(
  userId,
  workspaceId,
  "Je vais chercher des infos sur Pythagore...",
  [
    {
      name: "read_rag_source",
      arguments: { sourceId: "1" },
      result: "Le théorème de Pythagore...",
      timestamp: Date.now(),
    },
  ],
  "Le théorème de Pythagore est un principe fondamental...",
  []
);

// Récupérer l'historique formaté pour le brain
const history = ConversationHistoryService.formatHistoryForBrain(
  userId,
  workspaceId
);
```

#### 2. **TokenCounterService**
Compte les tokens de l'historique en utilisant tiktoken.

```typescript
// Compter les tokens d'un historique
const history = ConversationHistoryService.getHistory(userId, workspaceId);
const tokenCount = TokenCounterService.countHistoryTokens(history);

console.log(tokenCount.totalTokens); // ex: 150,000
console.log(tokenCount.needsCompression); // false (< 200k)
```

**Seuil de compression** : 200,000 tokens

#### 3. **HistoryCompressionService**
Compresse l'historique avec GPT-4o-mini.

```typescript
// Compresser un historique
const history = ConversationHistoryService.getHistory(userId, workspaceId);
const compressionResult = await HistoryCompressionService.compressHistory(
  history
);

console.log(compressionResult.originalTokens); // ex: 210,000
console.log(compressionResult.compressedTokens); // ex: 4,000
console.log(compressionResult.compressionRatio); // ex: 0.019 (1.9%)

// Remplacer l'historique par la version compressée
ConversationHistoryService.replaceWithCompressedHistory(
  userId,
  workspaceId,
  compressionResult.compressedContent
);
```

**Modèle utilisé** : `gpt-4o-mini`
- Contexte : 128k tokens en entrée
- Sortie : 16k tokens max (on vise 3-5k tokens)
- Coût : $0.15 par 1M input tokens, $0.6 par 1M output tokens

**Objectif de compression** : 3,000 - 5,000 tokens (moyenne 4,000)

## 🔌 Intégration

### Dans PlannerService

Le PlannerService reçoit l'historique via `PlanRequest.conversationHistory` :

```typescript
export interface PlanRequest {
  query: string;
  availableSources: Array<{ id: string; title: string; type: string }>;
  workspaceId: string;
  userId: string;
  isSearch: boolean;
  useWeb: boolean;
  systemPrompt?: string;
  onThinking?: (content: string) => void;
  conversationHistory?: string | null; // 🆕 Historique formaté
}
```

L'historique est injecté dans le prompt du brain :

```typescript
const historyContext = conversationHistory
  ? `\n\n# CONVERSATION HISTORY (CONTEXT)\n\nYou have access to the previous conversation history. Use it to maintain context and continuity in your planning.\n\n${conversationHistory}\n\n# CURRENT QUERY\n\nThe user is now asking:`
  : "";

const prompt = `${historyContext}You need to create a structured JSON plan...`;
```

### Dans askStream.ts

```typescript
// 1. Ajouter le message utilisateur
ConversationHistoryService.addUserMessage(userId, workspaceId, query, {
  web: useWeb,
  all: sourcesScope === "all",
  sources: sourcesForAI,
});

// 2. Récupérer et vérifier compression
let history = ConversationHistoryService.getHistory(userId, workspaceId);
let conversationHistory: string | null = null;

if (history && history.messages.length > 1) {
  const tokenCount = TokenCounterService.countHistoryTokens(history);

  if (tokenCount.needsCompression) {
    // Compresser avec GPT-4o-mini
    const compressionResult = await HistoryCompressionService.compressHistory(
      history
    );
    ConversationHistoryService.replaceWithCompressedHistory(
      userId,
      workspaceId,
      compressionResult.compressedContent
    );
    conversationHistory = compressionResult.compressedContent;
  } else {
    conversationHistory = ConversationHistoryService.formatHistoryForBrain(
      userId,
      workspaceId
    );
  }
}

// 3. Passer au CoordinatorService
const orchestrationRequest: OrchestrationRequest = {
  query,
  workspaceId,
  userId,
  conversationHistory, // 🆕
  // ... autres paramètres
};

const result = await CoordinatorService.orchestrateOptimized(
  orchestrationRequest
);

// 4. Sauvegarder la réponse AI
ConversationHistoryService.addAIMessage(
  userId,
  workspaceId,
  thinking,
  toolCalls,
  finalResponse,
  intermediateThinkingBlocks
);
```

## 📊 Structure de l'historique

### UserMessage

```typescript
{
  role: "user",
  content: "Parle moi de mathématiques",
  timestamp: 1234567890,
  parameters: {
    web: true,
    all: false,
    sources: [
      { id: "1", title: "Pythagore", type: "PDF" }
    ]
  }
}
```

### AIMessage

```typescript
{
  role: "assistant",
  timestamp: 1234567890,
  firstThinking: "Je vais chercher des informations sur les mathématiques...",
  tools: [
    {
      name: "read_rag_source",
      arguments: { sourceId: "1", query: "mathématiques" },
      result: "Le théorème de Pythagore est...",
      thinking: "Les résultats montrent...",
      timestamp: 1234567890
    }
  ],
  finalResponse: "Les mathématiques sont une science...",
  intermediateThinkingBlocks: [...]
}
```

### Historique formaté pour le brain

```
USER: Parle moi de mathématiques (web: true, sources: "Pythagore")
ASSISTANT: [thinking] Je vais chercher des informations... → [tools] read_rag_source → [response] Les mathématiques sont une science...

USER: Approfondis sil te plait
ASSISTANT: [thinking] Je vais approfondir... → [tools] search_web → [response] En approfondissant...
```

## 💰 Estimation des coûts

### Exemple de compression (historique de 210k tokens)

**Sans compression** :
- Envoi au brain : 210,000 tokens d'input
- Coût : ~$3.15 par requête (avec GPT-4o)

**Avec compression** :
- Compression (GPT-4o-mini) : 210,000 tokens input → 4,000 tokens output
  - Input : $0.0315 (210k × $0.15/1M)
  - Output : $0.0024 (4k × $0.6/1M)
  - Total compression : **$0.034**
- Envoi au brain : 4,000 tokens d'input
- Coût : ~$0.06 par requête (avec GPT-4o)

**Économie totale** : ~$3.09 par requête (~98% d'économie!)

## 🎯 Bonnes pratiques

### 1. Nettoyer l'historique régulièrement

```typescript
// Effacer l'historique après une session
ConversationHistoryService.clearHistory(userId, workspaceId);
```

### 2. Surveiller les tokens

```typescript
const history = ConversationHistoryService.getHistory(userId, workspaceId);
const tokenCount = TokenCounterService.countHistoryTokens(history);

if (tokenCount.totalTokens > 150_000) {
  console.warn("Approche du seuil de compression");
}
```

### 3. Estimer les coûts

```typescript
const tokenCount = TokenCounterService.countHistoryTokens(history);
const costEstimate = TokenCounterService.estimateCompressionCost(
  tokenCount.totalTokens
);

console.log(`Coût estimé compression : $${costEstimate.totalCost.toFixed(6)}`);
```

## 🔧 Paramètres configurables

### TokenCounterService

```typescript
// Seuil de compression (200k tokens par défaut)
static readonly COMPRESSION_THRESHOLD = 200_000;
```

### HistoryCompressionService

```typescript
// Objectif de compression (4k tokens par défaut)
static readonly TARGET_TOKENS = 4000;
```

## 📝 Logs et debugging

Le système log automatiquement les informations importantes :

```
📝 [HISTORY] Message utilisateur ajouté (3 messages totaux)
📝 [HISTORY] Réponse AI ajoutée (2 tools utilisés, 4 messages totaux)
📊 [TOKEN-COUNTER] Historique analysé:
   Total tokens: 210,500
   User messages: 50,000 tokens
   AI messages: 160,500 tokens
   Needs compression: YES (threshold: 200,000)
🗜️ [COMPRESSION] Début compression historique (4 messages)
📊 [COMPRESSION] Tokens originaux: 210,500
💰 [TOKEN-COUNTER] Estimation coût compression:
   Input: 210,500 tokens = $0.031575
   Output: 4,000 tokens (estimé) = $0.002400
   Total: $0.033975
✅ [COMPRESSION] Compression réussie: 210,500 → 4,100 tokens
📊 [COMPRESSION] Ratio de compression: 1.95%
🗜️ [HISTORY] Historique remplacé par version compressée pour user123:workspace456
```

## 🚀 Prochaines améliorations

- [ ] Stockage persistant de l'historique (actuellement en mémoire)
- [ ] Système de cache pour les compressions récentes
- [ ] Support de plusieurs workspaces par utilisateur
- [ ] Analytics sur l'utilisation et les coûts de compression
- [ ] Configuration par utilisateur des seuils de compression

## 📚 Références

- [OpenAI GPT-4o-mini](https://platform.openai.com/docs/models/gpt-4o-mini)
- [tiktoken](https://github.com/openai/tiktoken) - Token counting library
- [Compression techniques](https://platform.openai.com/docs/guides/prompt-engineering)
