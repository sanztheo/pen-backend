// preprocessor/constants.ts - Constantes des limites par plan
// Les valeurs numériques dérivent de PLAN_LIMITS (source unique de vérité).
// Seuls allowedQuestionTypes et advancedQuizzes sont spécifiques au quiz.

import { PLAN_LIMITS } from "../../../config/planLimits.js";
import { SubscriptionLimits, SubscriptionPlan, QuestionType } from "./types.js";

/** Types de questions autorisés par plan (quiz-spécifique, pas dans PLAN_LIMITS) */
const ALLOWED_QUESTION_TYPES: Record<SubscriptionPlan, QuestionType[]> = {
  free_user: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
  premium: ["OPEN_QUESTION", "MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING"],
  ultra: ["OPEN_QUESTION", "MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING"],
};

/**
 * Limites par plan d'abonnement — dérivées de PLAN_LIMITS + quiz-specific fields
 */
export const SUBSCRIPTION_LIMITS: Record<SubscriptionPlan, SubscriptionLimits> = {
  free_user: {
    maxQuestionsPerQuiz: PLAN_LIMITS.free_user.questionsPerQuizLimit,
    allowedQuestionTypes: ALLOWED_QUESTION_TYPES.free_user,
    maxPagesSelection: PLAN_LIMITS.free_user.pagesSelectionLimit,
    maxQuizzesPerMonth: PLAN_LIMITS.free_user.customQuizzesLimit,
    advancedQuizzes: PLAN_LIMITS.free_user.advancedQuizzesLimit === -1,
  },
  premium: {
    maxQuestionsPerQuiz: PLAN_LIMITS.premium.questionsPerQuizLimit,
    allowedQuestionTypes: ALLOWED_QUESTION_TYPES.premium,
    maxPagesSelection: PLAN_LIMITS.premium.pagesSelectionLimit,
    maxQuizzesPerMonth: PLAN_LIMITS.premium.customQuizzesLimit,
    advancedQuizzes: PLAN_LIMITS.premium.advancedQuizzesLimit === -1,
  },
  ultra: {
    maxQuestionsPerQuiz: PLAN_LIMITS.ultra.questionsPerQuizLimit,
    allowedQuestionTypes: ALLOWED_QUESTION_TYPES.ultra,
    maxPagesSelection: PLAN_LIMITS.ultra.pagesSelectionLimit,
    maxQuizzesPerMonth: PLAN_LIMITS.ultra.customQuizzesLimit,
    advancedQuizzes: PLAN_LIMITS.ultra.advancedQuizzesLimit === -1,
  },
};

/**
 * Types de questions par défaut pour chaque plan
 */
export const DEFAULT_QUESTION_TYPES: Record<SubscriptionPlan, QuestionType[]> = {
  free_user: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
  premium: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
  ultra: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
};

/**
 * Messages d'upgrade pour chaque limitation
 */
export const UPGRADE_MESSAGES = {
  questionCount:
    "Votre plan est limité en nombre de questions. Passez au plan supérieur pour en débloquer davantage.",
  questionTypes:
    "Les types de questions OPEN_QUESTION et MATCHING nécessitent un plan Pro ou Ultra.",
  pagesSelection:
    "Votre plan est limité en nombre de pages. Passez au plan supérieur pour en sélectionner davantage.",
  advancedQuizzes: "Les quiz avancés nécessitent un plan Pro ou Ultra.",
} as const;
