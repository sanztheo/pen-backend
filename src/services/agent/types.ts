/**
 * Types partagés pour Pennote Agent
 */

import type { ModelMessage } from "ai";

// ============================================
// MODES DE L'AGENT
// ============================================

/**
 * Niveau de réflexion par mode — provider-agnostic.
 * Google: mapped to thinkingConfig.thinkingLevel
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Intent auto-detected from the user message.
 * - conversation: standard Q&A (default)
 * - creation: user wants content/page created
 */
export type IntentType = "conversation" | "creation";

/**
 * 2 modes only: fast (1 credit) and deep (3 credits).
 * Intent detection determines the workflow variant.
 */
export const MODE_CONFIG = {
  fast: {
    maxSteps: 10,
    maxTokens: 4096,
    description: "Réponses rapides avec RAG",
    thinking: "medium" as ThinkingLevel,
  },
  deep: {
    maxSteps: 25,
    maxTokens: 16384,
    description: "Recherche approfondie et contenu détaillé",
    thinking: "high" as ThinkingLevel,
  },
} as const;

export type AgentMode = keyof typeof MODE_CONFIG;

/**
 * Composite key for prompt selection: mode × intent.
 */
export type PromptKey = `${AgentMode}-${IntentType}`;

// ============================================
// 📝 INTERFACES
// ============================================

/**
 * Configuration de requête pour l'agent
 */
export interface AgentRequest {
  messages: ModelMessage[];
  mode: AgentMode;
  intent?: IntentType;
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
  /** Mem0 memory entries relevant to current query */
  memoryContext?: string[];
  /** Agent marketplace — agent ID (preset or custom) */
  agentId?: string;
  /** Agent marketplace — "preset" or "custom" */
  agentType?: "preset" | "custom";
  /** Agent marketplace — pre-resolved agent prompt and name (resolved by caller) */
  agentPrompt?: { name: string; systemPrompt: string };
  /** Model selector — override model ID (from AGENT_SELECTABLE_MODELS) */
  modelOverride?: string;
  /** Model selector — override thinking level */
  thinkingOverride?: string;
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
