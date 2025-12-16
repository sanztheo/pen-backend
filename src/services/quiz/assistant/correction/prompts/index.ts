// assistant/correction/prompts/index.ts - Exports des prompts de correction

export {
  buildCorrectionSystemPrompt,
  buildCompleteCorrectionSystemPrompt,
} from "./correctionSystemPrompt.js";

export {
  buildStandardCorrectionPrompt,
  buildCompleteCorrectionPrompt,
} from "./correctionUserPrompt.js";
