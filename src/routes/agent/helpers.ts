import type { Request } from "express";
import type { AgentMode } from "../../services/agent/index.js";

/** Interface pour les résultats des workflows */
export interface WorkflowResult {
  content: string;
  title?: string;
  summary?: string;
  sources?: unknown[];
  searches?: unknown[];
  iterations?: number;
  pageId?: string | null;
  research?: {
    summary?: string;
    sources?: unknown[];
  };
}

/** SEC-03: Limite taille messages pour prévenir prompt injection / abus */
export const MAX_MESSAGE_LENGTH = 50000;
export const MAX_MESSAGES_COUNT = 200;

/** Credit cost per mode: fast=1, deep=3 */
export const CREDIT_COSTS: Record<AgentMode, number> = {
  fast: 1,
  deep: 3,
};

/** Type guard — narrows string to AgentMode after validation */
export function isAgentMode(mode: unknown): mode is AgentMode {
  return mode === "fast" || mode === "deep";
}

export const calculateDynamicCost = (req: Request): number => {
  const body = req.body || {};
  const mode = body.mode;
  if (isAgentMode(mode)) return CREDIT_COSTS[mode];
  return CREDIT_COSTS.fast;
};

/** Estimated output tokens per mode for quota checks */
export const ESTIMATED_OUTPUT_TOKENS: Record<AgentMode, number> = {
  fast: 2000,
  deep: 8000,
};

export const estimateOutputTokens = (mode: string): number => {
  if (isAgentMode(mode)) return ESTIMATED_OUTPUT_TOKENS[mode];
  return ESTIMATED_OUTPUT_TOKENS.fast;
};
