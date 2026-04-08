/**
 * Limites par plan — source unique de vérité.
 * Pur config, aucun side-effect (pas de SDK init, pas de env var check).
 * Importé par paddleBilling.ts, quiz preprocessor, sync-limits, etc.
 */

/** Limites par plan — Free/Pro/Ultra */
export const PLAN_LIMITS: Record<
  "free_user" | "premium" | "ultra",
  {
    aiCreditsLimit: number;
    workspacesLimit: number;
    customQuizzesLimit: number;
    presetSequencesLimit: number;
    pagesSelectionLimit: number;
    questionsPerQuizLimit: number;
    advancedQuizzesLimit: number;
    customAgentsLimit: number;
    dailyExpensiveModelLimit: number;
  }
> = {
  free_user: {
    aiCreditsLimit: 50,
    workspacesLimit: 1,
    customQuizzesLimit: 5,
    presetSequencesLimit: 1,
    pagesSelectionLimit: 2,
    questionsPerQuizLimit: 10,
    advancedQuizzesLimit: 10,
    customAgentsLimit: 1,
    dailyExpensiveModelLimit: 0,
  },
  premium: {
    aiCreditsLimit: 500,
    workspacesLimit: 1,
    customQuizzesLimit: 20,
    presetSequencesLimit: -1,
    pagesSelectionLimit: 10,
    questionsPerQuizLimit: 20,
    advancedQuizzesLimit: -1,
    customAgentsLimit: 5,
    dailyExpensiveModelLimit: 0,
  },
  ultra: {
    aiCreditsLimit: 2000,
    workspacesLimit: 1,
    customQuizzesLimit: -1,
    presetSequencesLimit: -1,
    pagesSelectionLimit: 30,
    questionsPerQuizLimit: 40,
    advancedQuizzesLimit: -1,
    customAgentsLimit: 20,
    dailyExpensiveModelLimit: 100,
  },
};
