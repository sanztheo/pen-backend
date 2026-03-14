// 🤖 Pennote Agent - Vercel AI SDK v6
import { streamText, stepCountIs, type ToolSet, type StreamTextResult } from "ai";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";
import { createPageTools } from "./tools/pageTools.js";
import { createWikipediaTools } from "./tools/wikipediaTools.js";
import { logger } from "../../utils/logger.js";
import { MODELS } from "../../config/models.js";
import { getProviderInstance } from "../../config/providers.js";
import { getModelProvider } from "../../config/models/helpers.js";

// Types et configuration
import {
  MODE_CONFIG,
  type AgentRequest,
  type AgentStreamCallbacks,
  type ThinkingLevel,
} from "./types.js";

// System prompts
import { buildSystemPrompt } from "./systemPrompts.js";

// Re-export types
export type { AgentMode, AgentRequest, AgentStreamCallbacks } from "./types.js";

// ── Provider-specific thinking config ────────────────────────────────────────

/**
 * Sélectionne le modèle en fonction du niveau de thinking.
 * Tous les providers (Moonshot, Google, etc.) utilisent le même modèle —
 * le thinking est contrôlé via providerOptions.
 */
function resolveModelForThinking(_thinking: ThinkingLevel): string {
  return MODELS.AGENT_PRIMARY;
}

/**
 * Construit les providerOptions spécifiques au provider pour le thinking.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProviderOptions(modelId: string, thinking: ThinkingLevel): any {
  const provider = getModelProvider(modelId);

  if (provider === "google") {
    return {
      google: {
        thinkingConfig: { thinkingLevel: thinking, includeThoughts: true },
      },
    };
  }

  // Moonshot K2.5: thinking contrôlé via providerOptions (pas de modèle séparé)
  if (provider === "moonshot") {
    const useThinking = thinking === "medium" || thinking === "high";
    if (useThinking) {
      const budgetTokens = thinking === "high" ? 8192 : 4096;
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
    userId,
    workspaceId,
    useWeb = false,
    ragSources,
    conversationHistory,
    personalization,
  } = request;

  const { maxSteps, maxTokens } = MODE_CONFIG[mode];

  // Contexte partagé avec tous les tools
  const toolContext = { userId, workspaceId };

  // Créer les tools avec le contexte
  const ragTools = createRagTools(toolContext);
  const workspaceTools = createWorkspaceTools(toolContext);
  const webTools = createWebTools(toolContext);
  const pageTools = createPageTools(toolContext);
  const wikipediaTools = createWikipediaTools(toolContext);

  // 🧠 AGENT INTELLIGENT: Tous les outils sont disponibles pour tous les modes
  // La différence entre modes est dans maxSteps et le system prompt qui guide l'intensité
  const tools = {
    ...ragTools,
    ...workspaceTools,
    ...webTools,
    ...pageTools,
    ...wikipediaTools,
  } satisfies ToolSet;

  // System prompt
  const systemPrompt = buildSystemPrompt(mode, {
    workspaceId,
    ragSources,
    personalization,
    conversationHistory,
  });

  // Résoudre modèle + provider dynamiquement selon le thinking level
  const { thinking } = MODE_CONFIG[mode];
  const modelName = resolveModelForThinking(thinking);
  const providerInstance = getProviderInstance(modelName);
  const providerName = getModelProvider(modelName) || "unknown";

  if (!providerInstance) {
    throw new Error(
      `[PennoteAgent] Provider "${providerName}" not configured for model "${modelName}". Check API key.`,
    );
  }

  const model = providerInstance(modelName);
  const providerOptions = buildProviderOptions(modelName, thinking);

  logger.log(`🤖 [PennoteAgent] Mode: ${mode}, maxSteps: ${maxSteps}, useWeb: ${useWeb}`);
  logger.log(`🤖 [PennoteAgent] Tools disponibles: ${Object.keys(tools).join(", ")}`);
  logger.log(
    `🤖 [PennoteAgent] Provider: ${providerName}, Model: ${modelName}, Thinking: ${thinking}`,
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

    // Callback global à la fin du stream
    onFinish: ({ text, finishReason, usage, reasoning, sources }) => {
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
        toolCalls: toolCalls.length,
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
          toolCalls: toolCalls.map((tc) => ({
            toolName: tc.toolName,
            args: tc.input,
          })),
          text: text || "",
        });
      }

      // Log des tool calls pour debug
      for (const tc of toolCalls) {
        logger.log(`  🔧 Tool: ${tc.toolName}`, tc.input);
        callbacks?.onToolCall?.(tc.toolName, tc.input);
      }

      // Log des résultats
      for (const tr of toolResults) {
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
