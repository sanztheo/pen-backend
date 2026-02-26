// First Thinking JSON structure - Plan generated at the start
export interface FirstThinkingPlan {
  plan: {
    totalIterations: number;
    reasoning: string;
    optimizedQuery?: string; // 🎯 NOUVEAU: Query reformulée et optimisée pour les premiers tools
    shouldUseTools: boolean; // 🆕 L'AI peut décider de ne pas utiliser de tools (ex: salutations, questions simples)
    toolSequence: Array<{
      step: number;
      toolName: string;
      description: string;
    }>;
  };
}

// Intermediate Thinking JSON structure - Generated after each tool execution
export interface IntermediateThinkingOutput {
  thinking: string;
  toolArguments: Record<string, unknown>;
  nextToolName?: string;
  shouldContinue?: boolean; // 🔥 NEW: Allow AI to decide whether to continue or stop
  modifiedToolSequence?: Array<{
    // 🔥 NEW: Allow AI to modify remaining tool sequence
    step: number;
    toolName: string;
    description: string;
  }>;
}

// Stored intermediate thinking block
export interface IntermediateThinkingBlock {
  iteration: number;
  thinking: string;
  toolArguments: Record<string, unknown>;
  generatedAt: string; // ISO timestamp
  nextToolName?: string;
  score?: unknown; // 🆕 Score du résultat du tool (ToolResultScore) - unknown pour éviter dépendance circulaire
  strategyAdjustment?: string; // 🆕 Recommandations de la stratégie adaptative
}

// Type guard for JSON validation
export const isFirstThinkingPlan = (obj: unknown): obj is FirstThinkingPlan => {
  if (typeof obj !== "object" || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  if (typeof candidate.plan !== "object" || candidate.plan === null) return false;
  const plan = candidate.plan as Record<string, unknown>;
  return (
    typeof plan.totalIterations === "number" &&
    typeof plan.reasoning === "string" &&
    typeof plan.shouldUseTools === "boolean" &&
    Array.isArray(plan.toolSequence)
  );
};

export const isIntermediateThinkingOutput = (obj: unknown): obj is IntermediateThinkingOutput => {
  if (typeof obj !== "object" || obj === null) return false;
  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.thinking === "string" &&
    typeof candidate.toolArguments === "object" &&
    candidate.toolArguments !== null
  );
};
