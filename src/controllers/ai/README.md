# Structure des Contrôleurs AI

Cette structure modulaire sépare les différentes fonctionnalités IA en fichiers distincts pour une meilleure organisation et maintenabilité.

## Structure

```
controllers/ai/
├── index.ts           # Exports principaux
├── base.ts           # Test de connexion et configuration
├── content.ts        # Génération et amélioration de contenu
├── specialized.ts    # Fonctions spécialisées (blocs, résumés, traductions)
├── autocomplete.ts   # Autocomplétion et WebSocket streaming
└── README.md         # Cette documentation
```

## Fichiers

### `base.ts`
- `testAI()` - Test de configuration et connexion OpenAI

### `content.ts`
- `generateContent()` - Génération de contenu général
- `improveContent()` - Amélioration de contenu existant
- `continueContent()` - Continuation de texte

### `specialized.ts`
- `generateBlock()` - Génération de blocs spécifiques (code, listes, etc.)
- `summarizeContent()` - Résumé de contenu
- `generateIdeas()` - Génération d'idées
- `translateContent()` - Traduction
- `correctText()` - Correction orthographique et grammaticale

### `autocomplete.ts`
- `autocomplete()` - Autocomplétion intelligente (mode classique)
- `handleAutocompleteWebSocket()` - Gestionnaire WebSocket pour autocomplétion streaming

## Utilisation

```typescript
// Import depuis l'index principal
import { testAI, generateContent, autocomplete } from './controllers/ai';

// Ou import spécifique
import { testAI } from './controllers/ai/base';
import { generateContent } from './controllers/ai/content';
```

## Migration

Les anciens imports `from './controllers/ai'` fonctionnent toujours grâce au fichier `index.ts` qui réexporte toutes les fonctions. 