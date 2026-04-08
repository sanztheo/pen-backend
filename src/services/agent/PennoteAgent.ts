// 🤖 Pennote Agent - Vercel AI SDK v6
import { streamText, smoothStream, type ToolSet, type StreamTextResult } from "ai";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";
import { createPageTools } from "./tools/pageTools.js";
import { createQuizTools } from "./tools/quizTools.js";
import { createEditTools } from "./tools/editTools.js";
import { createStructureTools } from "./tools/structureTools.js";
import { createPageReadingTools } from "./tools/pageReadingTools.js";
import { logger } from "../../utils/logger.js";
import { MODELS } from "../../config/models.js";
import { getProviderInstance } from "../../config/providers.js";
import { getModelProvider } from "../../config/models/helpers.js";

// Types et configuration
import {
  MODE_CONFIG,
  type AgentRequest,
  type AgentStreamCallbacks,
  type IntentType,
  type ThinkingLevel,
} from "./types.js";

// System prompts
import { buildSystemPrompt, sanitizeForPrompt } from "./systemPrompts.js";

// Re-export types
export type { AgentMode, IntentType, AgentRequest, AgentStreamCallbacks } from "./types.js";

// ── Provider-specific thinking config ────────────────────────────────────────

/**
 * Sélectionne le modèle en fonction du niveau de thinking.
 * If a model override is provided (from user selection), use it.
 * Otherwise use the default AGENT_PRIMARY.
 */
function resolveModelForThinking(_thinking: ThinkingLevel, modelOverride?: string): string {
  return modelOverride || MODELS.AGENT_PRIMARY;
}

/** Max duration for agent streaming calls (milliseconds) */
const AGENT_STREAM_MAX_DURATION_MS = 300_000;

// ── Research loop detection ─────────────────────────────────────────────────
/** Tools that indicate a "research" step (web/wiki/RAG search) */
const RESEARCH_TOOL_NAMES = new Set([
  "searchWeb",
  "searchWikipedia",
  "getWikipediaArticle",
  "searchRagChunks",
  "readRagSource",
]);

/** Max consecutive steps with only research tools before forcing stop */
const MAX_CONSECUTIVE_RESEARCH_STEPS = 3;

interface StopConditionStep {
  toolCalls: Array<{ toolName: string }>;
  text: string;
}

/**
 * Custom stop condition: step count limit + research loop detection.
 * Prevents models (especially Kimi K2.5) from endlessly calling search tools
 * without ever producing content or calling action tools (createPage, etc.).
 */
function createAgentStopCondition(maxSteps: number) {
  return ({ steps }: { steps: StopConditionStep[] }): boolean => {
    if (steps.length >= maxSteps) return true;
    if (steps.length < MAX_CONSECUTIVE_RESEARCH_STEPS) return false;

    let consecutiveResearch = 0;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      const hasText = step.text && step.text.trim().length > 0;
      const hasToolCalls = step.toolCalls && step.toolCalls.length > 0;
      const allResearch =
        hasToolCalls && step.toolCalls.every((tc) => RESEARCH_TOOL_NAMES.has(tc.toolName));

      if (!hasText && allResearch) {
        consecutiveResearch++;
      } else {
        break;
      }
    }

    if (consecutiveResearch >= MAX_CONSECUTIVE_RESEARCH_STEPS) {
      logger.warn(
        `⚠️ [PennoteAgent] Research loop detected: ${consecutiveResearch} consecutive research-only steps. Force-stopping.`,
      );
      return true;
    }

    return false;
  };
}

// ── Dev-only debug logger ────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV === "development";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_LOG_DIR = join(__dirname, "../../../logs/penly-debug");

interface DevLogStep {
  step: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  toolResults: Array<{ name: string; output: unknown }>;
  text: string;
  reasoning: unknown;
  tokens: number | undefined;
}

interface DevLogEntry {
  timestamp: string;
  mode: string;
  intent: string;
  model: string;
  provider: string;
  agentName: string | undefined;
  userMessage: string;
  steps: DevLogStep[];
  finalText: string;
  reasoning: unknown;
  totalTokens: number | undefined;
  finishReason: string;
}

async function writeDevLog(entry: DevLogEntry): Promise<void> {
  if (!IS_DEV) return;
  try {
    await mkdir(DEV_LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}_${entry.mode}.json`;
    await writeFile(join(DEV_LOG_DIR, filename), JSON.stringify(entry, null, 2), "utf-8");
    logger.log(`[DevLog] Saved to logs/penly-debug/${filename}`);
  } catch (err) {
    logger.warn(`[DevLog] Failed to write:`, err);
  }
}

interface ResolvedProvider {
  modelName: string;
  providerInstance: NonNullable<ReturnType<typeof getProviderInstance>>;
  providerName: string;
}

function resolveProvider(thinking: ThinkingLevel, modelOverride?: string): ResolvedProvider {
  const modelName = resolveModelForThinking(thinking, modelOverride);
  const providerInstance = getProviderInstance(modelName);
  const providerName = getModelProvider(modelName) || "unknown";

  if (!providerInstance) {
    // If override failed, fall back to default
    if (modelOverride) {
      logger.warn(
        `[PennoteAgent] Provider not configured for override model "${modelName}", falling back to AGENT_PRIMARY`,
      );
      return resolveProvider(thinking);
    }
    throw new Error(
      `[PennoteAgent] Provider "${providerName}" not configured for model "${modelName}". Check API key.`,
    );
  }

  return {
    modelName,
    providerInstance,
    providerName,
  };
}

/** OpenAI reasoning_effort values supported by GPT-5.4 Nano */
const OPENAI_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const;
type OpenAIReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

function isOpenAIReasoningEffort(value: string): value is OpenAIReasoningEffort {
  return (OPENAI_REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * Construit les providerOptions spécifiques au provider pour le thinking.
 * thinkingOverride allows passing a raw provider-specific level (e.g. "xhigh" for OpenAI).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProviderOptions(
  modelId: string,
  thinking: ThinkingLevel,
  enableNativeWebSearch = true,
  thinkingOverride?: string,
): any {
  const provider = getModelProvider(modelId);

  if (provider === "google") {
    // thinkingOverride is already a valid Google thinkingLevel for selectable models
    const level = thinkingOverride || thinking;
    const googleOptions: Record<string, unknown> = {
      useSearchGrounding: enableNativeWebSearch,
    };
    // Google only accepts "minimal"|"low"|"medium"|"high" — omit thinkingConfig for "none"
    if (level !== "none") {
      googleOptions.thinkingConfig = { thinkingLevel: level, includeThoughts: true };
    }
    return { google: googleOptions };
  }

  // OpenAI: reasoning_effort for reasoning models
  // "none" = no reasoning requested → don't send reasoning param at all
  if (provider === "openai") {
    const effort = thinkingOverride || thinking;
    if (effort !== "none" && isOpenAIReasoningEffort(effort)) {
      return {
        openai: {
          reasoningEffort: effort,
          reasoningSummary: "auto",
        },
      };
    }
    return {};
  }

  // Moonshot K2.5: thinking contrôlé via providerOptions (pas de modèle séparé)
  if (provider === "moonshot") {
    const level = thinkingOverride || thinking;
    const useThinking = level === "low" || level === "medium" || level === "high";
    if (useThinking) {
      const budgetTokens = level === "high" ? 8192 : level === "medium" ? 4096 : 2048;
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
    memoryContext,
    modelOverride,
    thinkingOverride,
    autoAccept,
  } = request;

  const { maxSteps, maxTokens, thinking } = MODE_CONFIG[mode];

  // Resolve model + provider — use user's model selection if provided
  const { modelName, providerInstance, providerName } = resolveProvider(thinking, modelOverride);

  // Shared context for all tools
  const toolContext = { userId, workspaceId };
  const toolContextWithLang = { userId, workspaceId, language: personalization?.language };
  const skipApproval = autoAccept === true;

  // Create tools with context
  const ragTools = createRagTools(toolContext);
  const workspaceTools = createWorkspaceTools(toolContext);
  const webTools = createWebTools(toolContextWithLang);
  const pageTools = createPageTools(toolContext, skipApproval);
  const quizTools = createQuizTools(toolContext);
  const editTools = createEditTools(toolContext, skipApproval);
  const structureTools = createStructureTools(toolContext);
  const pageReadingTools = createPageReadingTools(toolContext);

  // Google providers use native Search Grounding (useSearchGrounding in providerOptions)
  // so searchWeb tool is excluded — the model searches Google natively.
  // Other providers keep searchWeb as a tool (OpenAI Responses API fallback).
  const isGoogleProvider = providerName === "google";
  const tools = {
    ...ragTools,
    ...workspaceTools,
    ...pageReadingTools,
    ...(!isGoogleProvider
      ? webTools
      : {
          searchWikipedia: webTools.searchWikipedia,
          getWikipediaArticle: webTools.getWikipediaArticle,
        }),
    ...pageTools,
    ...quizTools,
    ...editTools,
    ...structureTools,
  } satisfies ToolSet;

  // System prompt — pass hasNativeWebSearch so the prompt doesn't mention searchWeb for Google
  let systemPrompt = buildSystemPrompt(mode, intent, {
    workspaceId,
    ragSources,
    personalization,
    conversationHistory,
    hasNativeWebSearch: isGoogleProvider,
    memoryContext,
  });

  // Agent marketplace — inject specialized agent instructions (pre-resolved by caller)
  if (request.agentPrompt) {
    systemPrompt += `\n\n<agent-instructions>
You are a specialized agent: ${sanitizeForPrompt(request.agentPrompt.name)}
${sanitizeForPrompt(request.agentPrompt.systemPrompt)}
</agent-instructions>`;
  }

  const model = providerInstance(modelName);
  const providerOptions = buildProviderOptions(
    modelName,
    thinking,
    isGoogleProvider,
    thinkingOverride,
  );

  logger.log(`🤖 [PennoteAgent] Mode: ${mode}, maxSteps: ${maxSteps}, useWeb: ${useWeb}`);
  logger.log(`🤖 [PennoteAgent] Tools disponibles: ${Object.keys(tools).join(", ")}`);
  logger.log(
    `🤖 [PennoteAgent] Provider: ${providerName}, Model: ${modelName}, Thinking: ${thinkingOverride || thinking}`,
  );

  // OpenAI Responses API: reasoning items must stay paired with their function_call items.
  // SDK v6.0.140+ handles reasoning round-trip correctly — no stripping needed.

  // Dev-only: accumulate steps for debug log file
  const devLogSteps: DevLogStep[] = [];
  const lastUserMsgContent = [...messages].reverse().find((m) => m.role === "user")?.content;
  const lastUserMsg =
    typeof lastUserMsgContent === "string"
      ? lastUserMsgContent
      : JSON.stringify(lastUserMsgContent ?? "");

  let stepNumber = 0;

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    maxOutputTokens: maxTokens,
    timeout: AGENT_STREAM_MAX_DURATION_MS,
    stopWhen: createAgentStopCondition(maxSteps),
    toolChoice: "auto",
    providerOptions,
    experimental_transform: smoothStream({ delayInMs: 20, chunking: "word" }),

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

      // Dev-only: write full conversation log to file
      writeDevLog({
        timestamp: new Date().toISOString(),
        mode,
        intent,
        model: modelName,
        provider: providerName,
        agentName: request.agentPrompt?.name,
        userMessage: lastUserMsg,
        steps: devLogSteps,
        finalText: text || "",
        reasoning,
        totalTokens: usage?.totalTokens,
        finishReason: finishReason || "unknown",
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

      // Dev-only: accumulate step data for file log
      devLogSteps.push({
        step: stepNumber,
        toolCalls: safeToolCalls.map((tc) => ({ name: tc.toolName, args: tc.input })),
        toolResults: safeToolResults.map((tr) => ({ name: tr.toolName, output: tr.output })),
        text: text || "",
        reasoning,
        tokens: usage?.totalTokens,
      });

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
