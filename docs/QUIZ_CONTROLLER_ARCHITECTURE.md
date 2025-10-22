# Architecture Modulaire du Quiz Controller

## 📋 Vue d'ensemble

Ce document décrit la refactorisation du fichier monolithique `src/controllers/quiz.ts` (2446 lignes, 36 méthodes) en une architecture modulaire organisée par domaines fonctionnels.

### 🎯 Objectifs du refactoring

1. **Séparation des responsabilités** : Chaque contrôleur gère un domaine fonctionnel spécifique
2. **Maintenabilité** : Code plus facile à comprendre et à modifier
3. **Testabilité** : Modules isolés plus faciles à tester unitairement
4. **Scalabilité** : Structure extensible pour ajouter de nouvelles fonctionnalités
5. **Rétrocompatibilité** : Maintien de l'API existante via un contrôleur unifié

---

## 🏗️ Architecture Finale

```
src/controllers/quiz/
├── index.ts                                    # Point d'entrée principal (exports + UnifiedQuizController)
│
├── utils/
│   └── validators.ts                          # Utilitaires de validation (1 fonction)
│
├── quiz/
│   ├── quizController.ts                      # CRUD de base (4 méthodes)
│   │   ├── generateQuiz()
│   │   ├── getQuiz()
│   │   ├── submitQuiz()
│   │   └── getQuizHistory()
│   │
│   └── preferencesController.ts               # Préférences utilisateur (2 méthodes)
│       ├── getUserPreferences()
│       └── updateUserPreferences()
│
├── sequences/
│   ├── sequenceController.ts                  # Séquences de quiz (7 méthodes)
│   │   ├── startPresetSequence()
│   │   ├── getSequenceStatus()
│   │   ├── generateNextQuiz()
│   │   ├── generateParallelQuizzes()
│   │   ├── getSequenceResults()
│   │   ├── submitSequentialQuiz()
│   │   └── getQuizCorrection()
│   │
│   └── sequenceDebugController.ts             # Debug séquences (1 méthode)
│       └── forceResetSequenceState()
│
├── documents/
│   └── documentController.ts                  # Recherche documentaire (2 méthodes)
│       ├── searchDocuments()
│       └── getDocumentStats()
│
├── assistant/
│   ├── assistantHealthController.ts           # Health checks Assistant (3 méthodes)
│   │   ├── createAssistantThread()
│   │   ├── pingAssistant()
│   │   └── testSimpleAssistant()
│   │
│   ├── generationController.ts                # Génération avec Assistant (5 méthodes)
│   │   ├── generateAssistantGraphics()
│   │   ├── generateAssistantDocuments()
│   │   ├── generateAssistantDocumentsFull()
│   │   ├── generateAssistantComplete()
│   │   └── generateAssistantStandard()
│   │
│   └── correctionController.ts                # Correction avec Assistant (4 méthodes)
│       ├── correctAssistantGraphics()
│       ├── correctAssistantDocuments()
│       ├── correctAssistantComplete()
│       └── correctAssistantStandard()
│
└── content/
    ├── pagesProjectsController.ts             # Pages & Projets (2 méthodes)
    │   ├── getPagesProjects()
    │   └── analyzePagesProjects()
    │
    └── ragController.ts                       # RAG & Fast Correction (2 méthodes)
        ├── buildQuizRAGContext()
        └── saveFastCorrection()
```

---

## 📊 Statistiques

### Avant refactoring
- **1 fichier** : `quiz.ts`
- **2446 lignes** de code
- **36 méthodes** dans une seule classe
- **1 fonction utilitaire** globale

### Après refactoring
- **13 fichiers** organisés par domaine
- **10 contrôleurs** spécialisés
- **36 méthodes** réparties logiquement
- **1 module** d'utilitaires
- **Rétrocompatibilité** via UnifiedQuizController

---

## 🔍 Description des Modules

### 1. **utils/validators.ts**
**Responsabilité** : Validation des données d'entrée

**Fonctions** :
- `validateSourceDocuments()` : Valide la taille et le format des documents sources

**Usage** :
```typescript
import { validateSourceDocuments } from '../utils/validators.js';
const validation = validateSourceDocuments(sourceDocuments);
if (!validation.valid) {
  return res.status(400).json({ error: validation.error });
}
```

---

### 2. **quiz/quizController.ts**
**Responsabilité** : Opérations CRUD de base sur les quiz

**Méthodes** :
1. `generateQuiz()` - POST /api/quiz/generate
   - Génère un nouveau quiz selon les paramètres
   - Supporte 3 modes : pages/projets (RAG), workspaces, générique
   - Gère l'embedding automatique des pages

2. `getQuiz()` - GET /api/quiz/:id
   - Récupère un quiz par ID

3. `submitQuiz()` - POST /api/quiz/:id/submit
   - Soumet un quiz pour correction avec streaming
   - Utilise Server-Sent Events (SSE)

4. `getQuizHistory()` - GET /api/quiz/history
   - Récupère l'historique paginé
   - Utilise le cache Redis

**Routes** : `/api/quiz/*`

---

### 3. **quiz/preferencesController.ts**
**Responsabilité** : Gestion des préférences utilisateur

**Méthodes** :
1. `getUserPreferences()` - GET /api/quiz/preferences
2. `updateUserPreferences()` - PUT /api/quiz/preferences

**Routes** : `/api/quiz/preferences`

---

### 4. **sequences/sequenceController.ts**
**Responsabilité** : Gestion des séquences de quiz (Bac, Partiels, etc.)

**Méthodes** :
1. `startPresetSequence()` - POST /api/quiz/preset/start
   - Démarre une séquence (BAC, PARTIELS, etc.)
   - Incrémente le compteur de limites utilisateur

2. `getSequenceStatus()` - GET /api/quiz/sequence/:sequenceId

3. `generateNextQuiz()` - POST /api/quiz/sequence/:sequenceId/next

4. `generateParallelQuizzes()` - POST /api/quiz/sequence/:sequenceId/parallel-generate
   - Génère plusieurs quiz en parallèle (optimisation performance)

5. `getSequenceResults()` - GET /api/quiz/sequence/:sequenceId/results

6. `submitSequentialQuiz()` - POST /api/quiz/sequence/:sequenceId/quiz/:quizId/submit

7. `getQuizCorrection()` - GET /api/quiz/sequence/:sequenceId/quiz/:quizId/correction

**Routes** : `/api/quiz/sequence/*`, `/api/quiz/preset/*`

---

### 5. **sequences/sequenceDebugController.ts**
**Responsabilité** : Outils de debugging pour les séquences

**Méthodes** :
1. `forceResetSequenceState()` - POST /api/quiz/sequence/:sequenceId/force-reset
   - Réinitialise les états de génération bloqués
   - Synchronise avec tempSequenceStorage et la BDD

**Routes** : `/api/quiz/sequence/:sequenceId/force-reset`

---

### 6. **documents/documentController.ts**
**Responsabilité** : Recherche et statistiques documentaires (Wikipedia embeddings)

**Méthodes** :
1. `searchDocuments()` - POST /api/quiz/search-documents
   - Recherche sémantique dans la base d'embeddings
   - Support des topics et seuils de similarité

2. `getDocumentStats()` - GET /api/quiz/documents/stats
   - Statistiques de la base documentaire

**Routes** : `/api/quiz/search-documents`, `/api/quiz/documents/stats`

---

### 7. **assistant/assistantHealthController.ts**
**Responsabilité** : Health checks et tests de l'OpenAI Assistant

**Méthodes** :
1. `createAssistantThread()` - POST /api/quiz/assistant/thread
2. `pingAssistant()` - POST /api/quiz/assistant/ping
3. `testSimpleAssistant()` - POST /api/quiz/assistant/test-simple

**Routes** : `/api/quiz/assistant/thread`, `/api/quiz/assistant/ping`, `/api/quiz/assistant/test-simple`

---

### 8. **assistant/generationController.ts**
**Responsabilité** : Génération de quiz avec OpenAI Assistant

**Méthodes** :
1. `generateAssistantGraphics()` - POST /api/quiz/assistant/generate-graphics
   - Quiz avec graphiques (matplotlib, plotly, etc.)

2. `generateAssistantDocuments()` - POST /api/quiz/assistant/generate-documents
   - Quiz basé sur des documents recherchés

3. `generateAssistantDocumentsFull()` - POST /api/quiz/assistant/generate-documents-full
   - Quiz avec documents complets via File Upload
   - Troncature intelligente à 6500 chars par document

4. `generateAssistantComplete()` - POST /api/quiz/assistant/generate-complete
   - Quiz multimédia complet (graphiques + documents)

5. `generateAssistantStandard()` - POST /api/quiz/assistant/generate-standard
   - Quiz standard sans média enrichi

**Routes** : `/api/quiz/assistant/generate-*`

**Spécificités** :
- Utilise `generateWithRetry()` pour la robustesse
- Recherche documentaire automatique
- Troncature intelligente des documents (6500 chars)

---

### 9. **assistant/correctionController.ts**
**Responsabilité** : Correction de quiz avec OpenAI Assistant (Chat Completion)

**Méthodes** :
1. `correctAssistantGraphics()` - POST /api/quiz/assistant/correct-graphics
2. `correctAssistantDocuments()` - POST /api/quiz/assistant/correct-documents
3. `correctAssistantComplete()` - POST /api/quiz/assistant/correct-complete
4. `correctAssistantStandard()` - POST /api/quiz/assistant/correct-standard

**Routes** : `/api/quiz/assistant/correct-*`

**Spécificités** :
- Utilise Chat Completion API avec JSON strict mode
- `correctWithRetry()` pour la robustesse
- Schémas de réponse avancés selon le type de correction

---

### 10. **content/pagesProjectsController.ts**
**Responsabilité** : Gestion des pages et projets utilisateur

**Méthodes** :
1. `getPagesProjects()` - GET /api/quiz/pages-projects
   - Liste toutes les pages et projets accessibles
   - Calcule les estimations de questions

2. `analyzePagesProjects()` - POST /api/quiz/analyze-pages-projects
   - Analyse détaillée des éléments sélectionnés

**Routes** : `/api/quiz/pages-projects`, `/api/quiz/analyze-pages-projects`

---

### 11. **content/ragController.ts**
**Responsabilité** : Contexte RAG et corrections rapides

**Méthodes** :
1. `buildQuizRAGContext()` - POST /api/quiz/context-rag
   - Construit le contexte RAG pour les pages sélectionnées
   - Gère le reprocessing automatique des pages échouées
   - Support du mode "pages_only" vs "all_sources"

2. `saveFastCorrection()` - POST /api/quiz/save-fast-correction
   - Sauvegarde une correction calculée côté frontend
   - Marque le quiz comme complété
   - Invalide le cache Redis de l'historique

**Routes** : `/api/quiz/context-rag`, `/api/quiz/save-fast-correction`

**Spécificités** :
- Extraction de contenu depuis blockNoteContent
- Embedding automatique avec userPagesRAG
- Filtrage intelligent des sources RAG

---

## 🔄 Rétrocompatibilité

### UnifiedQuizController

Le fichier `index.ts` exporte un **UnifiedQuizController** qui fusionne tous les contrôleurs modulaires :

```typescript
export const UnifiedQuizController = Object.assign(
  {},
  BaseQuizController,
  PreferencesController,
  SequenceController,
  SequenceDebugController,
  DocumentController,
  AssistantHealthController,
  AssistantGenerationController,
  AssistantCorrectionController,
  PagesProjectsController,
  RAGController
);
```

### Usage

**Ancien code** (toujours fonctionnel) :
```typescript
import { QuizController } from './controllers/quiz.ts';
QuizController.generateQuiz(req, res);
```

**Nouveau code** (recommandé) :
```typescript
import { QuizController } from './controllers/quiz/index.js';
QuizController.generateQuiz(req, res);
```

**Ou imports spécifiques** :
```typescript
import { QuizController } from './controllers/quiz/quiz/quizController.js';
import { SequenceController } from './controllers/quiz/sequences/sequenceController.js';
```

---

## 📝 Principes de Design

### 1. **Séparation des responsabilités (SRP)**
Chaque contrôleur a une responsabilité unique et bien définie.

### 2. **Découplage**
Les contrôleurs n'ont pas de dépendances entre eux (sauf via les services partagés).

### 3. **Consistance**
- Tous les contrôleurs utilisent le pattern `static async methodName(req, res)`
- Gestion d'erreurs cohérente avec try/catch
- Réponses JSON standardisées : `{ success, message, data }`

### 4. **Pas de modification logique**
Le contenu des fonctions reste **exactement identique** à l'original. Seule l'organisation des fichiers change.

---

## 🚀 Migration des Routes

Les routes existantes restent **inchangées**. Il suffit de mettre à jour les imports :

### Avant
```typescript
import { QuizController } from '../controllers/quiz.js';

router.post('/generate', QuizController.generateQuiz);
router.get('/history', QuizController.getQuizHistory);
```

### Après
```typescript
import { UnifiedQuizController as QuizController } from '../controllers/quiz/index.js';

router.post('/generate', QuizController.generateQuiz);
router.get('/history', QuizController.getQuizHistory);
```

**Ou** (imports modulaires) :
```typescript
import { QuizController } from '../controllers/quiz/quiz/quizController.js';
import { SequenceController } from '../controllers/quiz/sequences/sequenceController.js';

router.post('/generate', QuizController.generateQuiz);
router.post('/preset/start', SequenceController.startPresetSequence);
```

---

## 🧪 Tests

L'architecture modulaire facilite les tests unitaires :

```typescript
// Tester uniquement le contrôleur de séquences
import { SequenceController } from '@/controllers/quiz/sequences/sequenceController';

describe('SequenceController', () => {
  it('should start a preset sequence', async () => {
    // Test isolé sans dépendances externes
  });
});
```

---

## 📦 Dépendances

### Services externes utilisés
- `QuizService` (services/quiz/quizService.js)
- `OpenAIAssistantService` (services/quiz/assistant/index.js)
- `documentSearchService` (services/quiz/documentSearchService.js)
- `CorrectionGenerator` (services/quiz/generators/correctionGenerator.js)
- `ragSystem` (services/rag/index.js)
- `userPagesRAG` (services/rag/userPages.js)
- `prisma` (lib/prisma.js)
- `redis` (lib/redis.js)

---

## ✅ Avantages de la Nouvelle Architecture

### Pour les développeurs
1. **Compréhension rapide** : Chaque fichier a une responsabilité claire
2. **Navigation facilitée** : Structure de dossiers intuitive
3. **Modifications localisées** : Changements isolés par domaine
4. **Réutilisabilité** : Imports granulaires possibles

### Pour la maintenance
1. **Tests isolés** : Chaque contrôleur testable indépendamment
2. **Debugging simplifié** : Logs et erreurs par module
3. **Évolutivité** : Ajout de nouvelles fonctionnalités sans impacter l'existant
4. **Documentation** : Structure auto-documentée

### Pour les performances
1. **Imports sélectifs** : Chargement uniquement des modules nécessaires
2. **Tree-shaking** : Bundlers peuvent optimiser le code inutilisé
3. **Hot reload** : Modifications localisées pour un rechargement rapide

---

## 🔮 Évolutions Futures

### Possibilités d'amélioration
1. **Middleware de validation** : Extraire les validations communes
2. **Types partagés** : Définir des interfaces pour les requêtes/réponses
3. **Factory pattern** : Pour instancier les services (injection de dépendances)
4. **Décorateurs** : Pour la gestion des erreurs et des logs
5. **Tests end-to-end** : Par domaine fonctionnel

---

## 📚 Références

- Fichier original : `src/controllers/quiz.ts` (2446 lignes)
- Architecture modulaire : `src/controllers/quiz/` (13 fichiers)
- Services : `src/services/quiz/`
- Types : `src/services/quiz/types.ts`

---

## 🎉 Conclusion

Cette refactorisation transforme un fichier monolithique de 2446 lignes en une architecture modulaire de **13 fichiers** organisés par **domaine fonctionnel**, tout en **maintenant 100% de rétrocompatibilité** avec l'API existante.

L'architecture est maintenant **scalable**, **maintenable** et **testable**, prête pour les évolutions futures du projet ! 🚀
