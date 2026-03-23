// 🤖 Pennote Agent - Vercel AI SDK v6
import { streamText, stepCountIs, type ToolSet, type StreamTextResult } from "ai";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";
import { createPageTools } from "./tools/pageTools.js";
import { createWikipediaTools } from "./tools/wikipediaTools.js";
import { createQuizTools } from "./tools/quizTools.js";
import { logger } from "../../utils/logger.js";
import { MODELS } from "../../config/models.js";
import { getProviderInstance } from "../../config/providers.js";
import { getModelProvider } from "../../config/models/helpers.js";
import { isCircuitOpen, recordSuccess, recordFailure } from "../../lib/circuitBreaker.js";

// Types et configuration
import {
  MODE_CONFIG,
  type AgentRequest,
  type AgentStreamCallbacks,
  type IntentType,
  type ThinkingLevel,
} from "./types.js";

// System prompts
import { buildSystemPrompt } from "./systemPrompts.js";

// Re-export types
export type { AgentMode, IntentType, AgentRequest, AgentStreamCallbacks } from "./types.js";

// ── Circuit breaker key ──────────────────────────────────────────────────────

const CIRCUIT_KEY_PRIMARY = "ai-provider-primary";

// ── Provider-specific thinking config ────────────────────────────────────────

/**
 * Sélectionne le modèle en fonction du niveau de thinking.
 * Tous les providers (Moonshot, Google, etc.) utilisent le même modèle —
 * le thinking est contrôlé via providerOptions.
 */
function resolveModelForThinking(_thinking: ThinkingLevel): string {
  return MODELS.AGENT_PRIMARY;
}

interface ResolvedProvider {
  modelName: string;
  providerInstance: NonNullable<ReturnType<typeof getProviderInstance>>;
  providerName: string;
  usingFallback: boolean;
}

/**
 * Resolve provider with circuit breaker failover.
 * If primary circuit is open, switch to AGENT_FALLBACK model.
 */
function resolveProviderWithFailover(thinking: ThinkingLevel): ResolvedProvider {
  const primaryModel = resolveModelForThinking(thinking);
  const primaryProvider = getModelProvider(primaryModel) || "unknown";

  // Check circuit breaker — if primary is healthy, use it
  if (!isCircuitOpen(CIRCUIT_KEY_PRIMARY)) {
    const instance = getProviderInstance(primaryModel);
    if (instance) {
      return {
        modelName: primaryModel,
        providerInstance: instance,
        providerName: primaryProvider,
        usingFallback: false,
      };
    }
  }

  // Primary unavailable or circuit open — try fallback
  const fallbackModel = MODELS.AGENT_FALLBACK;
  const fallbackProvider = getModelProvider(fallbackModel) || "unknown";
  const fallbackInstance = getProviderInstance(fallbackModel);

  if (fallbackInstance) {
    logger.log(
      `[PennoteAgent] Failover: ${primaryProvider}/${primaryModel} → ${fallbackProvider}/${fallbackModel}`,
    );
    return {
      modelName: fallbackModel,
      providerInstance: fallbackInstance,
      providerName: fallbackProvider,
      usingFallback: true,
    };
  }

  // Last resort: try primary even if circuit is open (better than crashing)
  const lastResort = getProviderInstance(primaryModel);
  if (lastResort) {
    logger.log(`[PennoteAgent] Fallback unavailable, forcing primary despite open circuit`);
    return {
      modelName: primaryModel,
      providerInstance: lastResort,
      providerName: primaryProvider,
      usingFallback: false,
    };
  }

  throw new Error(
    `[PennoteAgent] No AI provider available. Primary "${primaryProvider}" and fallback "${fallbackProvider}" both unconfigured.`,
  );
}

/**
 * Construit les providerOptions spécifiques au provider pour le thinking.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProviderOptions(
  modelId: string,
  thinking: ThinkingLevel,
  enableNativeWebSearch = true,
): any {
  const provider = getModelProvider(modelId);

  if (provider === "google") {
    return {
      google: {
        thinkingConfig: { thinkingLevel: thinking, includeThoughts: true },
        useSearchGrounding: enableNativeWebSearch,
      },
    };
  }

  // Moonshot K2.5: thinking contrôlé via providerOptions (pas de modèle séparé)
  if (provider === "moonshot") {
    const useThinking = thinking === "low" || thinking === "medium" || thinking === "high";
    if (useThinking) {
      const budgetTokens = thinking === "high" ? 8192 : thinking === "medium" ? 4096 : 2048;
      return {
        moonshotai: {
          thinking: { type: "enabled", budgetTokens },
        },
      };
    }
    return {};
  }

  return {};
}

/**
 * Exécute l'agent Pennote avec streaming
 */
export function runPennoteAgent(
  request: AgentRequest,
  callbacks?: AgentStreamCallbacks,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): StreamTextResult<any, any> {
  const {
    messages,
    mode,
    intent = "conversation" as IntentType,
    userId,
    workspaceId,
    useWeb = false,
    ragSources,
    conversationHistory,
    personalization,
  } = request;

  const { maxSteps, maxTokens, thinking } = MODE_CONFIG[mode];

  // Resolve model + provider with circuit breaker failover
  const { modelName, providerInstance, providerName, usingFallback } =
    resolveProviderWithFailover(thinking);

  // Shared context for all tools
  const toolContext = { userId, workspaceId };
  const toolContextWithLang = { userId, workspaceId, language: personalization?.language };

  // Create tools with context
  const ragTools = createRagTools(toolContext);
  const workspaceTools = createWorkspaceTools(toolContext);
  const webTools = createWebTools(toolContextWithLang);
  const pageTools = createPageTools(toolContext);
  const wikipediaTools = createWikipediaTools(toolContextWithLang);
  const quizTools = createQuizTools(toolContext);

  // Google providers use native Search Grounding (useSearchGrounding in providerOptions)
  // so searchWeb tool is excluded — the model searches Google natively.
  // Other providers keep searchWeb as a tool (OpenAI Responses API fallback).
  const isGoogleProvider = providerName === "google";
  const tools = {
    ...ragTools,
    ...workspaceTools,
    ...(!isGoogleProvider
      ? webTools
      : {
          searchWikipedia: webTools.searchWikipedia,
          getWikipediaArticle: webTools.getWikipediaArticle,
        }),
    ...pageTools,
    ...wikipediaTools,
    ...quizTools,
  } satisfies ToolSet;

  // System prompt — pass hasNativeWebSearch so the prompt doesn't mention searchWeb for Google
  const systemPrompt = buildSystemPrompt(mode, intent, {
    workspaceId,
    ragSources,
    personalization,
    conversationHistory,
    hasNativeWebSearch: isGoogleProvider,
  });

  const model = providerInstance(modelName);
  const providerOptions = buildProviderOptions(modelName, thinking, isGoogleProvider);

  logger.log(`🤖 [PennoteAgent] Mode: ${mode}, maxSteps: ${maxSteps}, useWeb: ${useWeb}`);
  logger.log(`🤖 [PennoteAgent] Tools disponibles: ${Object.keys(tools).join(", ")}`);
  logger.log(
    `🤖 [PennoteAgent] Provider: ${providerName}, Model: ${modelName}, Thinking: ${thinking}${usingFallback ? " (FALLBACK)" : ""}`,
  );

  let stepNumber = 0;

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    maxOutputTokens: maxTokens,
    stopWhen: stepCountIs(maxSteps),
    toolChoice: "auto",
    providerOptions,

    // Callback global à la fin du stream — circuit breaker tracking
    onFinish: ({ text, finishReason, usage, reasoning, sources }) => {
      // Track circuit breaker state (only for primary provider)
      if (!usingFallback) {
        if (finishReason === "error" || finishReason === "other") {
          recordFailure(CIRCUIT_KEY_PRIMARY);
        } else {
          recordSuccess(CIRCUIT_KEY_PRIMARY);
        }
      }

      logger.log(`🏁 [PennoteAgent] Stream terminé:`, {
        finishReason,
        hasText: !!text,
        textLength: text?.length || 0,
        textPreview: text?.slice(0, 200) || "(vide)",
        hasReasoning: !!reasoning,
        reasoningLength: reasoning?.length || 0,
        sourcesCount: sources?.length || 0,
        tokens: usage?.totalTokens,
      });
    },

    // Callback à chaque étape terminée
    onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage, reasoning }) => {
      stepNumber++;
      const safeToolCalls = toolCalls.filter((toolCall) => toolCall !== undefined);
      const safeToolResults = toolResults.filter((toolResult) => toolResult !== undefined);

      // Debug: afficher le format exact du reasoning
      let reasoningDebug = "(vide)";
      if (reasoning) {
        if (Array.isArray(reasoning)) {
          reasoningDebug = `[Array(${reasoning.length})] ${JSON.stringify(reasoning).slice(0, 200)}`;
        } else if (typeof reasoning === "string") {
          reasoningDebug = (reasoning as string).slice(0, 100);
        } else {
          reasoningDebug = JSON.stringify(reasoning).slice(0, 100);
        }
      }

      logger.log(`📍 [PennoteAgent] Step ${stepNumber} terminé:`, {
        finishReason,
        toolCalls: safeToolCalls.length,
        hasText: !!text,
        textLength: text?.length || 0,
        textPreview: text?.slice(0, 200) || "(vide)",
        reasoningType: reasoning
          ? Array.isArray(reasoning)
            ? "array"
            : typeof reasoning
          : "undefined",
        reasoningDebug,
        tokens: usage?.totalTokens,
      });

      // Callback externe
      if (callbacks?.onStepFinish) {
        callbacks.onStepFinish({
          stepNumber,
          toolCalls: safeToolCalls.map((tc) => ({
            toolName: tc.toolName,
            args: tc.input,
          })),
          text: text || "",
        });
      }

      // Log des tool calls pour debug
      for (const tc of safeToolCalls) {
        logger.log(`  🔧 Tool: ${tc.toolName}`, tc.input);
        callbacks?.onToolCall?.(tc.toolName, tc.input);
      }

      // Log des résultats
      for (const tr of safeToolResults) {
        const output = tr.output;
        const preview =
          typeof output === "string" ? output.slice(0, 100) : JSON.stringify(output).slice(0, 100);
        logger.log(`  ✅ Result: ${preview}...`);
        callbacks?.onToolResult?.(tr.toolName, output);
      }
    },
  });

  return result;
}

/**
 * Version simple pour les tests - retourne la réponse complète
 */
export async function runPennoteAgentSimple(request: AgentRequest): Promise<{
  text: string;
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>;
  usage: { totalTokens: number };
}> {
  const result = await runPennoteAgent(request);

  // Attendre la fin du stream
  await result.response; // Attendre que le stream soit terminé
  const text = await result.text;
  const toolCalls = (await result.toolCalls) || [];
  const toolResults = (await result.toolResults) || [];

  // Combiner tool calls et results
  const combinedToolCalls = toolCalls.map((tc, i) => ({
    toolName: tc.toolName,
    args: tc.input,
    result: toolResults[i]?.output,
  }));

  return {
    text,
    toolCalls: combinedToolCalls,
    usage: {
      totalTokens: (await result.usage)?.totalTokens || 0,
    },
  };
}
