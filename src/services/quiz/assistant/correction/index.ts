// assistant/correction/index.ts - Exports du module de correction (Chat Completion uniquement)

export { ChatCorrection, chatCorrection } from "./chatCorrection.js";
export {
  buildCorrectionSystemPrompt,
  buildCompleteCorrectionSystemPrompt,
  buildStandardCorrectionPrompt,
  buildCompleteCorrectionPrompt,
} from "./prompts/index.js";
