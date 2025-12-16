# Architecture du Module Assistant Quiz

## Vue d'ensemble

Le module `assistant` a été refactoré depuis un fichier monolithique `service.ts` (~2740 lignes) vers une architecture modulaire respectant les principes SOLID et facilitant la maintenabilité.

## Structure des dossiers

```
src/services/quiz/assistant/
├── index.ts                          # Export principal
├── service.ts                        # Service original (legacy)
├── service.refactored.ts             # Service refactoré (façade)
├── ARCHITECTURE.md                   # Cette documentation
│
├── config/                           # Configuration et constantes
│   ├── index.ts                      # Exports du module
│   ├── constants.ts                  # Labels des spécialités
│   └── schemas.ts                    # Schémas JSON stricts OpenAI
│
├── types/                            # Types et interfaces TypeScript
│   └── index.ts                      # Définitions de types
│
├── generation/                       # Module de génération de quiz
│   ├── index.ts                      # Exports du module
│   ├── questionGenerator.ts          # Génération via Chat Completion
│   ├── quizGenerators.ts             # Génération via Assistant API
│   └── prompts/                      # Prompts de génération
│       ├── index.ts
│       ├── systemPrompt.ts           # Prompt système XML
│       └── questionPrompt.ts         # Prompt utilisateur XML
│
├── correction/                       # Module de correction de quiz
│   ├── index.ts                      # Exports du module
│   ├── assistantCorrection.ts        # Correction via Assistant API
│   ├── chatCorrection.ts             # Correction via Chat Completion
│   └── prompts/                      # Prompts de correction
│       ├── index.ts
│       ├── correctionSystemPrompt.ts # Prompts système
│       └── correctionUserPrompt.ts   # Prompts utilisateur
│
├── utils/                            # Utilitaires partagés
│   ├── index.ts                      # Exports du module
│   ├── retry.ts                      # Gestion des retries
│   ├── validation.ts                 # Validation des réponses
│   ├── logging.ts                    # Logging structuré
│   └── helpers.ts                    # Fonctions utilitaires
│
└── [fichiers existants]              # Fichiers existants non modifiés
    ├── thread.ts                     # Gestion des threads OpenAI
    ├── fileManager.ts                # Gestion des fichiers
    ├── promptCache.ts                # Cache des prompts
    ├── professorPersonas.ts          # Personas professeurs
    ├── fewShotExamples.ts            # Exemples few-shot
    ├── functions.ts                  # Définitions des fonctions
    ├── tools.ts                      # Outils assistant
    └── parallelService.ts            # Service parallèle
```

## Modules détaillés

### 1. Config (`/config`)

Contient les constantes et schémas de configuration :

- **`constants.ts`** : Labels des spécialités scolaires françaises et fonction `formatSpecialtyLabel()`
- **`schemas.ts`** : Schémas JSON stricts pour la génération de questions et la correction

### 2. Types (`/types`)

Définitions TypeScript pour tout le module :

- Types de base : `QuizPreset`, `Difficulty`, `GraphicType`, etc.
- Interfaces d'options : `GenerateQuizOptions`, `CorrectQuizOptions`, etc.
- Types de données : `QuizAnswer`, `GraphicData`, `DocumentData`, etc.

### 3. Generation (`/generation`)

Module de génération de quiz avec deux approches :

- **`questionGenerator.ts`** : Génération de questions individuelles via Chat Completion + JSON strict
- **`quizGenerators.ts`** : Génération de quiz complets via l'API Assistant OpenAI
- **`prompts/`** : Construction des prompts XML structurés

### 4. Correction (`/correction`)

Module de correction de quiz avec deux approches :

- **`assistantCorrection.ts`** : Correction via l'API Assistant OpenAI
- **`chatCorrection.ts`** : Correction via Chat Completion + JSON strict
- **`prompts/`** : Construction des prompts de correction

### 5. Utils (`/utils`)

Utilitaires partagés entre les modules :

- **`retry.ts`** : Pattern retry avec backoff exponentiel
- **`validation.ts`** : Validation des réponses de l'assistant
- **`logging.ts`** : Fonctions de logging structuré pour debug
- **`helpers.ts`** : Fonctions utilitaires diverses (génération d'IDs, etc.)

## Pattern Façade

Le fichier `service.refactored.ts` implémente le pattern Façade :

```typescript
export class OpenAIAssistantServiceRefactored {
  // Modules spécialisés
  private questionGenerator: QuestionGenerator;
  private quizGenerators: QuizGenerators;
  private assistantCorrection: AssistantCorrection;
  private chatCorrection: ChatCorrection;

  // Méthodes déléguant aux modules
  async generateSingleQuestion(request: any): Promise<any> {
    return this.questionGenerator.generateSingleQuestion(request);
  }
  // ...
}
```

## Migration

Pour migrer vers la nouvelle architecture :

1. **Utilisation directe des modules** (recommandé) :
```typescript
import { QuestionGenerator } from './generation/questionGenerator.js';
import { ChatCorrection } from './correction/chatCorrection.js';

const generator = new QuestionGenerator();
const corrector = new ChatCorrection();
```

2. **Via le service refactoré** (rétrocompatibilité) :
```typescript
import { OpenAIAssistantService } from './service.refactored.js';

const service = new OpenAIAssistantService();
```

3. **Via le service legacy** (existant) :
```typescript
import { OpenAIAssistantService } from './service.js';
// Même API qu'avant
```

## Avantages de cette architecture

1. **Séparation des responsabilités** : Chaque module a une responsabilité unique
2. **Testabilité** : Modules isolés et facilement mockables
3. **Maintenabilité** : Modifications localisées sans impact sur l'ensemble
4. **Lisibilité** : Structure claire et prévisible
5. **Réutilisabilité** : Modules utilisables indépendamment
6. **Extensibilité** : Ajout de nouveaux modules sans modification de l'existant

## Schéma des dépendances

```
service.refactored.ts (Façade)
    ├── generation/questionGenerator.ts
    │       └── generation/prompts/*
    │       └── config/*
    ├── generation/quizGenerators.ts
    │       └── config/*
    │       └── thread.ts, promptCache.ts, fileManager.ts
    ├── correction/assistantCorrection.ts
    │       └── thread.ts, promptCache.ts
    ├── correction/chatCorrection.ts
    │       └── correction/prompts/*
    │       └── config/*
    │       └── utils/*
    └── utils/*
```

## Conventions de nommage

- **Fichiers** : camelCase (ex: `questionGenerator.ts`)
- **Classes** : PascalCase (ex: `QuestionGenerator`)
- **Fonctions** : camelCase (ex: `buildSystemPrompt`)
- **Types/Interfaces** : PascalCase (ex: `QuizPreset`)
- **Constantes** : SCREAMING_SNAKE_CASE (ex: `QUIZ_QUESTION_SCHEMA`)
