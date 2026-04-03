// 🤖 Agent Service - Export centralisé
export {
  runPennoteAgent,
  runPennoteAgentSimple,
  type AgentMode,
  type IntentType,
  type AgentRequest,
  type AgentStreamCallbacks,
} from "./PennoteAgent.js";

export { detectIntent, extractLastUserMessage } from "./intentClassifier.js";

export { createRagTools } from "./tools/ragTools.js";
export { createWorkspaceTools } from "./tools/workspaceTools.js";
export { createWebTools } from "./tools/webTools.js";
