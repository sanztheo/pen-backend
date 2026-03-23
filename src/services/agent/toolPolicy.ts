import type { IntentType } from "./types.js";

export interface ToolPolicyRagSource {
  id: string;
  title: string;
  type?: string;
}

export interface AgentToolPolicyInput {
  intent: IntentType;
  useWeb: boolean;
  ragSources?: ToolPolicyRagSource[];
  providerName: string;
}

export interface AgentToolPolicy {
  exposePageTools: boolean;
  exposeGeneralWebSearch: boolean;
  exposeWikipediaLookupTools: boolean;
  exposeWikipediaRagTools: boolean;
  hasNativeWebSearch: boolean;
}

export function resolveAgentToolPolicy(input: AgentToolPolicyInput): AgentToolPolicy {
  const hasNativeWebSearch = input.providerName === "google";
  const exposeGeneralWebSearch = !hasNativeWebSearch;
  const exposeWikipediaTools = true;

  return {
    exposePageTools: input.intent === "creation",
    exposeGeneralWebSearch,
    exposeWikipediaLookupTools: exposeWikipediaTools,
    exposeWikipediaRagTools: exposeWikipediaTools,
    hasNativeWebSearch,
  };
}
