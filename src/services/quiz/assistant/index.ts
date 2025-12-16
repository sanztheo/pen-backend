// assistant/index.ts - Point d'entrée principal du service OpenAI Assistant

export {
  createThread,
  addMessageToThread,
  runAssistantOnThread,
  waitForRunCompletion,
  checkRunStatus,
} from "./thread.js";

export { AVAILABLE_FUNCTIONS, type AssistantFunction } from "./tools.js";

// 🆕 Export du service refactoré
export { OpenAIAssistantService } from "./service.js";
export { ParallelAssistantService } from "./parallelService.js";

// Configuration des Assistants OpenAI
// 🎯 System Prompts gérés via promptCache.ts (plus flexible)

// Assistant Principal - System prompt SUPPRIMÉ sur OpenAI (géré en code)
export const ASSISTANT_ID =
  process.env.ASSISTANT_ID || "asst_T8qF1eohxChy7yzdfz4jsHaA";

// Assistant Documents - System prompt CONSERVÉ sur OpenAI (spécialisé)
export const ASSISTANT_ID_DOCUMENTS =
  process.env.ASSISTANT_ID_DOCUMENTS || "asst_0mHaOrweRvjNMxKd3I7XsUps";

// Assistant Parallèle - System prompt SUPPRIMÉ sur OpenAI (clone du principal)
export const ASSISTANT_ID_2 =
  process.env.ASSISTANT_ID_2 || "asst_cS3n1FNBIjMDwuvbz7xqsAKP";
