// First Thinking JSON structure - Plan generated at the start
export interface FirstThinkingPlan {
  plan: {
    totalIterations: number;
    reasoning: string;
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
  toolArguments: Record<string, any>;
  nextToolName?: string;
  shouldContinue?: boolean; // 🔥 NEW: Allow AI to decide whether to continue or stop
  modifiedToolSequence?: Array<{  // 🔥 NEW: Allow AI to modify remaining tool sequence
    step: number;
    toolName: string;
    description: string;
  }>;
}

// Stored intermediate thinking block
export interface IntermediateThinkingBlock {
  iteration: number;
  thinking: string;
  toolArguments: Record<string, any>;
  generatedAt: string; // ISO timestamp
  nextToolName?: string;
}

// Type guard for JSON validation
export const isFirstThinkingPlan = (obj: any): obj is FirstThinkingPlan => {
  return (
    obj &&
    obj.plan &&
    typeof obj.plan.totalIterations === 'number' &&
    typeof obj.plan.reasoning === 'string' &&
    Array.isArray(obj.plan.toolSequence)
  );
};

export const isIntermediateThinkingOutput = (
  obj: any,
): obj is IntermediateThinkingOutput => {
  return (
    obj &&
    typeof obj.thinking === 'string' &&
    typeof obj.toolArguments === 'object'
  );
};
