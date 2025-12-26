# Quiz Preprocessor - Validation des limites d'abonnement

## Vue d'ensemble

Le preprocessor de quiz valide et corrige les paramètres suggérés par l'IA pour respecter les limites d'abonnement de l'utilisateur.

## Problème résolu

L'agent IA peut suggérer 40 questions mais l'utilisateur free est limité à 10. Ce service intercepte la sortie de l'agent et corrige automatiquement les paramètres si nécessaire.

## Architecture

```
preprocessor/
├── types.ts            # Interfaces TypeScript
├── constants.ts        # Limites par plan (Free, Premium)
├── limitValidator.ts   # Service principal de validation
├── index.ts           # Exports publics
└── README.md          # Documentation
```

## Limites par plan

| Plan | Max Questions | Types autorisés | Pages max |
|------|---------------|-----------------|-----------|
| Free | 10 | MCQ, True/False | 2 |
| Premium | 40 | Tous | 30 |

## Usage

### Validation basique

```typescript
import { quizLimitValidator } from '@/services/quiz/preprocessor';

// Output de l'agent IA
const aiSuggestion = {
  recommendedQuestionCount: 40,
  questionTypes: ['MULTIPLE_CHOICE', 'OPEN_QUESTION'],
  difficulty: 'medium',
  suggestedTimeLimit: 60,
  reasoning: 'Based on content analysis...'
};

// Valider et corriger selon les limites utilisateur
const result = await quizLimitValidator.validateAndCorrect(
  aiSuggestion,
  userId
);

if (!result.isValid) {
  console.log('Corrections appliquées:', result.corrections);
  console.log('Upgrade requis:', result.upgradeRequired);
}

// Utiliser les paramètres corrigés
const correctedParams = result.correctedOutput;
```

### Vérification avant création

```typescript
import { quizLimitValidator } from '@/services/quiz/preprocessor';

const canCreate = await quizLimitValidator.canCreateQuiz(
  userId,
  questionCount,
  ['OPEN_QUESTION', 'MULTIPLE_CHOICE']
);

if (!canCreate.allowed) {
  return res.status(403).json({
    error: canCreate.reason,
    upgradeRequired: true
  });
}
```

### Récupération des limites

```typescript
import { quizLimitValidator } from '@/services/quiz/preprocessor';

const limits = quizLimitValidator.getLimitsForPlan('free_user');
// { maxQuestionsPerQuiz: 10, allowedQuestionTypes: [...], ... }
```

## Types principaux

### QuizPreprocessorOutput

```typescript
interface QuizPreprocessorOutput {
  recommendedQuestionCount: number;
  questionTypes: QuestionType[];
  difficulty: 'easy' | 'medium' | 'hard';
  suggestedTimeLimit: number | null;
  reasoning: string;
  correctedByLimits?: boolean;
  originalRecommendations?: {
    questionCount: number;
    questionTypes: QuestionType[];
  };
}
```

### ValidationResult

```typescript
interface ValidationResult {
  isValid: boolean;              // false si corrections appliquées
  correctedOutput: QuizPreprocessorOutput;
  corrections: ValidationCorrection[];
  upgradeRequired: boolean;      // true si limites dépassées
}
```

### ValidationCorrection

```typescript
interface ValidationCorrection {
  field: 'questionCount' | 'questionTypes' | 'timeLimit';
  originalValue: unknown;
  correctedValue: unknown;
  reason: string;  // Message d'upgrade
}
```

## Logique de correction

### 1. Nombre de questions

```
Si recommendedQuestionCount > maxQuestionsPerQuiz:
  → Réduire à maxQuestionsPerQuiz
  → Ajouter correction avec message d'upgrade
```

### 2. Types de questions

```
Si questionTypes contient des types non autorisés:
  → Filtrer les types autorisés uniquement
  → Si aucun type valide, utiliser les types par défaut du plan
  → Ajouter correction avec message d'upgrade
```

### 3. Quota mensuel (Free uniquement)

```
Si customQuizzesUsed >= customQuizzesLimit:
  → Retourner erreur avec message d'upgrade
```

## Intégration avec l'agent IA

Le preprocessor s'intègre après l'agent IA et avant la génération du quiz:

```
Agent IA → Suggestions → Preprocessor → Validation → Génération Quiz
                              ↓
                      Corrections appliquées
                      Message d'upgrade si nécessaire
```

## Messages d'upgrade

Les messages sont définis dans `constants.ts`:

- **questionCount**: "Le plan Free est limité à 10 questions..."
- **questionTypes**: "Les types OPEN_QUESTION et MATCHING sont réservés..."
- **pagesSelection**: "Le plan Free est limité à 2 pages..."
- **advancedQuizzes**: "Les quiz avancés sont réservés au plan Premium"

## Base de données

Le service utilise deux tables Prisma:

- **UserSubscription**: `plan`, `status`
- **UserLimits**: `questionsPerQuizLimit`, `pagesSelectionLimit`, `customQuizzesLimit`, etc.

## Sécurité

- Toutes les limites sont vérifiées côté backend
- Pas de fallback sur les limites (fail fast)
- Création automatique de UserLimits si manquant
- Validation stricte des types TypeScript

## Tests recommandés

1. **Free user demande 40 questions** → Doit corriger à 10
2. **Free user demande OPEN_QUESTION** → Doit filtrer/remplacer
3. **Premium user demande 40 questions** → Doit passer
4. **Free user quota épuisé** → Doit bloquer avec message
5. **UserLimits manquant** → Doit créer avec valeurs par défaut

## Évolution future

- [ ] Support du plan "Team" (100 questions max)
- [ ] Limites dynamiques par type de quiz (ENTRAINEMENT vs EXAMEN)
- [ ] Système de crédits pour les quiz avancés
- [ ] Analytics sur les corrections appliquées
