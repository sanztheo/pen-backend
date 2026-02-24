// preprocessor/constants.ts - Constantes des limites par plan

import { SubscriptionLimits, SubscriptionPlan, QuestionType } from "./types.js";

/**
 * Limites par plan d'abonnement
 */
export const SUBSCRIPTION_LIMITS: Record<SubscriptionPlan, SubscriptionLimits> = {
  free_user: {
    maxQuestionsPerQuiz: 10,
    allowedQuestionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
    maxPagesSelection: 2,
    maxQuizzesPerMonth: 5,
    advancedQuizzes: false,
  },
  premium: {
    maxQuestionsPerQuiz: 40,
    allowedQuestionTypes: ["OPEN_QUESTION", "MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING"],
    maxPagesSelection: 30,
    maxQuizzesPerMonth: -1, // Illimité
    advancedQuizzes: true,
  },
};

/**
 * Types de questions par défaut pour chaque plan
 */
export const DEFAULT_QUESTION_TYPES: Record<SubscriptionPlan, QuestionType[]> = {
  free_user: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
  premium: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
};

/**
 * Messages d'upgrade pour chaque limitation
 */
export const UPGRADE_MESSAGES = {
  questionCount:
    "Le plan Free est limité à 10 questions par quiz. Passez à Premium pour jusqu'à 40 questions.",
  questionTypes: "Les types de questions OPEN_QUESTION et MATCHING sont réservés au plan Premium.",
  pagesSelection:
    "Le plan Free est limité à 2 pages. Passez à Premium pour sélectionner jusqu'à 30 pages.",
  advancedQuizzes: "Les quiz avancés sont réservés au plan Premium.",
} as const;
