/**
 * 📦 Types partagés pour Pennote Agent
 */

import type { ModelMessage } from "ai";

// ============================================
// 🎯 MODES DE L'AGENT
// ============================================

/**
 * Configuration de l'agent par mode avec Gemini 3 thinkingLevel
 * Options: "minimal" | "low" | "medium" | "high"
 */
export const MODE_CONFIG = {
  ask: {
    maxSteps: 10,
    maxTokens: 4096,
    description: "Questions simples avec RAG",
    thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true },
  },
  search: {
    maxSteps: 25,
    maxTokens: 8192,
    description: "Recherche approfondie avec web",
    thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
  },
  "create-quick": {
    maxSteps: 10,
    maxTokens: 8192,
    description: "Génération rapide de contenu",
    thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
  },
  "create-deep": {
    maxSteps: 30,
    maxTokens: 32000,
    description: "Génération complète avec recherche",
    thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
  },
} as const;

export type AgentMode = keyof typeof MODE_CONFIG;

// ============================================
// 📝 INTERFACES
// ============================================

/**
 * Configuration de requête pour l'agent
 */
export interface AgentRequest {
  messages: ModelMessage[];
  mode: AgentMode;
  userId: string;
  workspaceId: string;
  useWeb?: boolean;
  ragSources?: Array<{ id: string; title: string }>;
  conversationHistory?: string;
  personalization?: {
    name?: string;
    language?: string;
    style?: string;
  };
}

/**
 * Options de callbacks pour le streaming
 */
export interface AgentStreamCallbacks {
  onStepStart?: (stepInfo: { stepNumber: number; toolName?: string }) => void;
  onStepFinish?: (stepInfo: {
    stepNumber: number;
    toolCalls: Array<{ toolName: string; args: unknown }>;
    text?: string;
  }) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
}
