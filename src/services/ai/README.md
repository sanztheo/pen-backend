# Structure des Services AI

Cette structure modulaire sépare les différentes fonctionnalités IA en services spécialisés pour une meilleure organisation et maintenabilité.

## Structure

```
services/ai/
├── index.ts               # Exports principaux
├── base.ts               # Configuration et classe AIService principale
├── contentGeneration.ts  # Service de génération de contenu
├── codeDetection.ts      # Service de détection et parsing de code
├── autocomplete.ts       # Service d'autocomplétion et streaming
└── README.md             # Cette documentation
```

## Fichiers

### `base.ts`
- `AIService` - Classe principale avec configuration OpenAI
- `isConfigured()` - Vérification de configuration
- `testConnection()` - Test de connexion OpenAI
- Méthodes déléguées vers les services spécialisés

### `contentGeneration.ts`
- `ContentGenerationService` - Service pour la génération de contenu
- `generateContent()` - Génération avec support streaming
- `generateBlock()` - Génération de blocs spécifiques
- `improveContent()` - Amélioration de contenu
- `continueContent()` - Continuation de texte
- `summarizeContent()` - Résumé
- `generateIdeas()` - Génération d'idées
- `translateContent()` - Traduction
- `correctText()` - Correction

### `codeDetection.ts`
- `CodeDetectionService` - Service pour la détection de code
- `parseMarkdownCode()` - Parser les blocs de code markdown
- `mapToAvailableLanguage()` - Mapper les langages détectés
- `detectCodeLanguage()` - Détecter le langage de programmation

### `autocomplete.ts`
- `AutocompleteService` - Service d'autocomplétion
- `autocompleteStream()` - Autocomplétion avec streaming WebSocket
- `autocomplete()` - Autocomplétion classique (legacy)
- `parsePartialSuggestions()` - Parser les suggestions partielles
- `detectWritingIntent()` - Détecter l'intention d'écriture

## Interfaces

### `AIGenerationOptions`
```typescript
interface AIGenerationOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  context?: string;
  signal?: AbortSignal;
  onStream?: (chunk: string) => void;
}
```

### `AIGenerationResult`
```typescript
interface AIGenerationResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
  detectedLanguage?: string;
}
```

### `AutocompleteStreamResult`
```typescript
interface AutocompleteStreamResult {
  suggestions: string[];
  context: {
    beforeCursor: string;
    afterCursor: string;
    detectedIntent: string;
  };
  isComplete: boolean;
  currentSuggestionIndex?: number;
}
```

## Utilisation

```typescript
// Import depuis l'index principal
import { AIService } from '../services/ai';

// Ou import direct du service
import { ContentGenerationService } from '../services/ai/contentGeneration';
import { AutocompleteService } from '../services/ai/autocomplete';
```

## Délégation

La classe `AIService` délègue automatiquement les appels vers les services spécialisés, maintenant ainsi la compatibilité avec l'ancienne API tout en bénéficiant de la nouvelle structure modulaire.

## Avantages

1. **Séparation des responsabilités** - Chaque service a un rôle bien défini
2. **Maintenance facilitée** - Code plus facile à maintenir et déboguer
3. **Extensibilité** - Facile d'ajouter de nouveaux services
4. **Performance** - Imports dynamiques pour réduire le temps de chargement initial
5. **Testabilité** - Services peuvent être testés indépendamment 