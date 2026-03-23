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

function hasAttachedWikipediaSource(ragSources?: ToolPolicyRagSource[]): boolean {
  return (ragSources || []).some(
    (source) => source.type === "wikipedia" || source.id?.startsWith("wikipedia:"),
  );
}

export function resolveAgentToolPolicy(input: AgentToolPolicyInput): AgentToolPolicy {
  const wikipediaAttached = hasAttachedWikipediaSource(input.ragSources);
  const allowExternalKnowledge = input.useWeb || wikipediaAttached;
  const hasNativeWebSearch = input.providerName === "google" && input.useWeb;

  return {
    exposePageTools: input.intent === "creation",
    exposeGeneralWebSearch: input.useWeb && !hasNativeWebSearch,
    exposeWikipediaLookupTools: allowExternalKnowledge,
    exposeWikipediaRagTools: allowExternalKnowledge,
    hasNativeWebSearch,
  };
}
