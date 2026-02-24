// preprocessor/index.ts - Exports principaux du preprocessor

export { QuizLimitValidator, quizLimitValidator } from "./limitValidator.js";
export { SUBSCRIPTION_LIMITS, DEFAULT_QUESTION_TYPES, UPGRADE_MESSAGES } from "./constants.js";
export type {
  QuizPreprocessorOutput,
  QuestionType,
  SubscriptionPlan,
  SubscriptionLimits,
  UserQuizContext,
  ValidationResult,
  ValidationCorrection,
} from "./types.js";

// PEN-36: AI Prompts
export {
  buildPreprocessorPrompt,
  QUIZ_PREPROCESSOR_SYSTEM_PROMPT,
  PREPROCESSOR_MODEL,
  PREPROCESSOR_TEMPERATURE,
  PREPROCESSOR_MAX_TOKENS,
} from "./prompts.js";
export type { QuizType, PreprocessorPromptParams, PreprocessorAIOutput } from "./prompts.js";

// PEN-33: Quiz Preprocessor Agent
export { QuizPreprocessorAgent, quizPreprocessorAgent } from "./QuizPreprocessorAgent.js";
