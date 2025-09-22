// assistant/tools.ts - Configuration pour l'assistant OpenAI Quiz
// Les 7 fonctions sont configurées directement dans l'Assistant OpenAI (asst_T8qF1eohxChy7yzdfz4jsHaA)
// Référence: @command.md avec schémas JSON stricts

/**
 * Documentation des fonctions disponibles dans l'Assistant OpenAI
 * Ces fonctions sont déjà configurées sur la plateforme OpenAI Assistants
 */
export const AVAILABLE_FUNCTIONS = [
  'generate_graphic',
  'generate_questions_array', 
  'generate_subject_with_documents',
  'correct_quiz_standard',
  'correct_quiz_with_graphics',
  'correct_quiz_with_documents',
  'correct_quiz_complete'
] as const;

export type AssistantFunction = typeof AVAILABLE_FUNCTIONS[number];