// preprocessor/types.ts - Types pour le preprocessor de quiz

/**
 * Output de l'agent IA avec recommandations de paramètres
 */
export interface QuizPreprocessorOutput {
  recommendedQuestionCount: number;
  questionTypes: QuestionType[];
  difficulty: "easy" | "medium" | "hard";
  suggestedTimeLimit: number | null;
  reasoning: string;
  correctedByLimits?: boolean;
  originalRecommendations?: {
    questionCount: number;
    questionTypes: QuestionType[];
  };
}

/**
 * Types de questions disponibles
 */
export type QuestionType = "OPEN_QUESTION" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MATCHING";

/**
 * Plans d'abonnement
 */
export type SubscriptionPlan = "free_user" | "premium" | "ultra";

/**
 * Limites par plan d'abonnement
 */
export interface SubscriptionLimits {
  maxQuestionsPerQuiz: number;
  allowedQuestionTypes: QuestionType[];
  maxPagesSelection: number;
  maxQuizzesPerMonth: number;
  advancedQuizzes: boolean;
}

/**
 * Contexte utilisateur pour validation
 */
export interface UserQuizContext {
  userId: string;
  plan: SubscriptionPlan;
  currentLimits: {
    questionsPerQuizLimit: number;
    pagesSelectionLimit: number;
    customQuizzesLimit: number;
    customQuizzesUsed: number;
  };
}

/**
 * Résultat de validation avec corrections appliquées
 */
export interface ValidationResult {
  isValid: boolean;
  correctedOutput: QuizPreprocessorOutput;
  corrections: ValidationCorrection[];
  upgradeRequired: boolean;
}

/**
 * Correction appliquée lors de la validation
 */
export interface ValidationCorrection {
  field: "questionCount" | "questionTypes" | "timeLimit";
  originalValue: unknown;
  correctedValue: unknown;
  reason: string;
}
