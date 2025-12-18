// 🤖 Pennote Agent - Vercel AI SDK v5
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";

/**
 * Configuration de l'agent par mode
 */
const MODE_CONFIG = {
  ask: {
    maxSteps: 10,
    description: "Questions simples avec RAG",
  },
  search: {
    maxSteps: 25,
    description: "Recherche approfondie avec web",
  },
  "create-quick": {
    maxSteps: 10,
    description: "Génération rapide de contenu",
  },
  "create-deep": {
    maxSteps: 30,
    description: "Génération complète avec recherche",
  },
} as const;

export type AgentMode = keyof typeof MODE_CONFIG;

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

/**
 * Construit le system prompt selon le mode et le contexte
 */
function buildSystemPrompt(
  mode: AgentMode,
  options: {
    workspaceId: string;
    ragSources?: Array<{ id: string; title: string }>;
    personalization?: AgentRequest["personalization"];
    conversationHistory?: string;
  },
): string {
  const { personalization, conversationHistory, ragSources } = options;

  // Base persona
  let persona = "";
  if (personalization?.name) {
    persona += `L'utilisateur s'appelle ${personalization.name}. `;
  }
  if (personalization?.style) {
    persona += `Style de communication préféré: ${personalization.style}. `;
  }

  // Instructions selon le mode
  const modeInstructions: Record<AgentMode, string> = {
    ask: `Tu es un assistant IA intelligent qui répond aux questions de manière claire et précise.
Utilise les outils RAG pour chercher dans les sources disponibles avant de répondre.
Si tu ne trouves pas l'information dans les sources, indique-le clairement.`,

    search: `Tu es un assistant de recherche approfondie.
Utilise TOUS les outils disponibles pour trouver les informations les plus complètes et pertinentes.
Fais des recherches dans le RAG ET sur le web si autorisé.
Synthétise les informations de manière structurée et cite tes sources.`,

    "create-quick": `Tu es un assistant de création de contenu rapide.
Génère du contenu concis et pertinent basé sur les sources disponibles.
Utilise les outils RAG pour enrichir ton contenu avec des informations factuelles.`,

    "create-deep": `Tu es un assistant de création de contenu expert.
Fais des recherches approfondies avant de générer du contenu.
Utilise le RAG, le web, et toutes les sources disponibles.
Crée du contenu riche, structuré et bien documenté.`,
  };

  // Sources disponibles
  let sourcesInfo = "";
  if (ragSources && ragSources.length > 0) {
    sourcesInfo = `\n\nSources RAG disponibles:\n${ragSources.map((s) => `- ${s.title} (ID: ${s.id})`).join("\n")}`;
  }

  // Historique de conversation
  let historySection = "";
  if (conversationHistory) {
    historySection = `\n\n📜 HISTORIQUE DE CONVERSATION:\n${conversationHistory}\n---`;
  }

  // LaTeX rules
  const latexRules = `
RÈGLES LATEX STRICTES:
- Pour les formules en ligne: $formule$
- Pour les formules en bloc: $$formule$$
- NE JAMAIS utiliser \\( \\) ou \\[ \\]
- Toujours utiliser les délimiteurs $ ou $$`;

  return `${modeInstructions[mode]}

${persona}
${latexRules}
${sourcesInfo}
${historySection}

Réponds en français sauf si l'utilisateur utilise une autre langue.
Sois précis, structuré et utile.`.trim();
}

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

  // Sélectionner les tools selon le mode et options
  const tools: Record<string, any> = {
    // RAG tools - toujours disponibles
    ...ragTools,
    // Workspace tools - toujours disponibles
    ...workspaceTools,
  };

  // Web tools - seulement si useWeb est activé
  if (useWeb) {
    tools.searchWeb = webTools.searchWeb;
    tools.searchWikipedia = webTools.searchWikipedia;
    tools.getWikipediaArticle = webTools.getWikipediaArticle;
  }

  // System prompt
  const systemPrompt = buildSystemPrompt(mode, {
    workspaceId,
    ragSources,
    personalization,
    conversationHistory,
  });

  // Modèle à utiliser
  const modelName = process.env.OPENAI_MODEL || "gpt-4o";

  console.log(
    `🤖 [PennoteAgent] Mode: ${mode}, maxSteps: ${maxSteps}, useWeb: ${useWeb}`,
  );
  console.log(
    `🤖 [PennoteAgent] Tools disponibles: ${Object.keys(tools).join(", ")}`,
  );

  let stepNumber = 0;

  // Exécuter streamText avec multi-steps
  const result = streamText({
    model: openai(modelName),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
    toolChoice: "auto",

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
          text,
        });
      }

      // Log des tool calls pour debug
      for (const tc of toolCalls) {
        console.log(`  🔧 Tool: ${tc.toolName}`, tc.input);
        callbacks?.onToolCall?.(tc.toolName, tc.input);
      }

      // Log des résultats
      for (const tr of toolResults) {
        const preview =
          typeof tr.output === "string"
            ? tr.output.slice(0, 100)
            : JSON.stringify(tr.output).slice(0, 100);
        console.log(`  ✅ Result: ${preview}...`);
        callbacks?.onToolResult?.(tr.toolName, tr.output);
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
