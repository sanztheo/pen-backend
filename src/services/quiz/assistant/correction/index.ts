// assistant/correction/index.ts - Exports du module de correction

export { AssistantCorrection, assistantCorrection } from "./assistantCorrection.js";
export { ChatCorrection, chatCorrection } from "./chatCorrection.js";
export {
  buildCorrectionSystemPrompt,
  buildCompleteCorrectionSystemPrompt,
  buildStandardCorrectionPrompt,
  buildCompleteCorrectionPrompt,
} from "./prompts/index.js";
