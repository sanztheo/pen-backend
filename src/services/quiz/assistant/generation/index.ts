// assistant/generation/index.ts - Exports du module de génération (Chat Completion uniquement)

export { QuestionGenerator, questionGenerator } from "./questionGenerator.js";
export {
  buildSystemPrompt,
  buildSingleQuestionPrompt,
} from "./prompts/index.js";
