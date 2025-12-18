// 🤖 Pennote Agent - Vercel AI SDK v5
import { streamText, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";
import { createPageTools } from "./tools/pageTools.js";

// Types et configuration
import {
  MODE_CONFIG,
  type AgentMode,
  type AgentRequest,
  type AgentStreamCallbacks,
} from "./types.js";

// System prompts
import { buildSystemPrompt } from "./systemPrompts.js";

// Re-export types
export type { AgentMode, AgentRequest, AgentStreamCallbacks } from "./types.js";

/**
 * Exécute l'agent Pennote avec streaming
 */
export async function runPennoteAgent(
  request: AgentRequest,
  callbacks?: AgentStreamCallbacks,
) {
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

  const { maxSteps } = MODE_CONFIG[mode];

  // Contexte partagé avec tous les tools
  const toolContext = { userId, workspaceId };

  // Créer les tools avec le contexte
  const ragTools = createRagTools(toolContext);
  const workspaceTools = createWorkspaceTools(toolContext);
  const webTools = createWebTools(toolContext);
  const pageTools = createPageTools(toolContext);

  // 🧠 AGENT INTELLIGENT: Tous les outils sont disponibles
  // L'IA décide intelligemment quels outils utiliser selon le contexte
  // Les priorités sont guidées par le system prompt, pas par des restrictions artificielles
  const tools: Record<string, any> = {
    // RAG tools - pour les sources du workspace
    ...ragTools,
    // Workspace tools - pour lire les pages
    ...workspaceTools,
    // Web tools - pour Wikipedia et recherche web si nécessaire
    ...webTools,
    // Page tools - pour créer des pages (mode create)
    ...pageTools,
  };

  // System prompt
  const systemPrompt = buildSystemPrompt(mode, {
    workspaceId,
    ragSources,
    personalization,
    conversationHistory,
  });

  // Modèle Gemini avec thinkingConfig selon le mode
  const { thinkingConfig } = MODE_CONFIG[mode];
  const modelName = "gemini-3-flash";

  console.log(
    `🤖 [PennoteAgent] Mode: ${mode}, maxSteps: ${maxSteps}, useWeb: ${useWeb}`,
  );
  console.log(
    `🤖 [PennoteAgent] Tools disponibles: ${Object.keys(tools).join(", ")}`,
  );
  console.log(
    `🤖 [PennoteAgent] Provider: Google, Model: ${modelName}, ThinkingLevel: ${thinkingConfig.thinkingLevel}`,
  );

  let stepNumber = 0;

  // Créer le modèle Gemini
  const model = google(modelName);

  // Exécuter streamText avec multi-steps et thinkingConfig via providerOptions
  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
    toolChoice: "auto",
    providerOptions: {
      google: { thinkingConfig },
    },

    // Callback à chaque étape terminée
    onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }) => {
      stepNumber++;

      console.log(`📍 [PennoteAgent] Step ${stepNumber} terminé:`, {
        finishReason,
        toolCalls: toolCalls.length,
        hasText: !!text,
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
        console.log(`  🔧 Tool: ${tc.toolName}`, tc.input);
        callbacks?.onToolCall?.(tc.toolName, tc.input);
      }

      // Log des résultats
      for (const tr of toolResults) {
        const output = tr.output;
        const preview =
          typeof output === "string"
            ? output.slice(0, 100)
            : JSON.stringify(output).slice(0, 100);
        console.log(`  ✅ Result: ${preview}...`);
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
