// 🤖 Pennote Agent - Vercel AI SDK v5
import { streamText, stepCountIs, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { createRagTools } from "./tools/ragTools.js";
import { createWorkspaceTools } from "./tools/workspaceTools.js";
import { createWebTools } from "./tools/webTools.js";
import { createPageTools } from "./tools/pageTools.js";

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
 * Interface pour la personnalisation utilisateur
 */
interface UserPersonalization {
  name?: string;
  classe?: string;
  etude?: string;
  filiere?: string;
  langue?: string;
  presentation?: string;
  attente?: string;
  style?: string;
}

/**
 * Construit le system prompt au format XML (pattern Claude/GPT-4)
 */
function buildSystemPrompt(
  mode: AgentMode,
  options: {
    workspaceId: string;
    ragSources?: Array<{ id: string; title: string; type?: string }>;
    personalization?: UserPersonalization;
    conversationHistory?: string;
  },
): string {
  const { personalization, conversationHistory, ragSources } = options;

  // Mode instructions
  const modeConfig: Record<AgentMode, { role: string; instructions: string }> =
    {
      ask: {
        role: "Assistant IA intelligent et pédagogue",
        instructions: `- Réponds de manière claire, précise et structurée
- Si des sources sont fournies, tu DOIS les consulter en priorité avec les outils RAG
- Si tu ne trouves pas l'information, indique-le honnêtement
- Adapte ton niveau de langage au profil de l'utilisateur`,
      },
      search: {
        role: "Expert en recherche documentaire",
        instructions: `- Effectue une recherche EXHAUSTIVE dans toutes les sources disponibles
- Utilise les outils RAG pour les sources fournies
- Si le web est activé, complète avec des recherches web
- Synthétise les informations de manière structurée
- Cite TOUJOURS tes sources`,
      },
      "create-quick": {
        role: "Rédacteur efficace",
        instructions: `- Génère du contenu concis et pertinent
- Utilise les sources fournies pour enrichir le contenu
- Reste factuel et précis
- Adapte le style au profil de l'utilisateur`,
      },
      "create-deep": {
        role: "Expert en création de contenu",
        instructions: `- Effectue des recherches approfondies avant de rédiger
- Utilise TOUTES les sources disponibles (RAG, web, Wikipedia)
- Crée un contenu riche, structuré et bien documenté
- Inclus des exemples et illustrations si pertinent
- Cite toutes tes sources`,
      },
    };

  const { role, instructions } = modeConfig[mode];

  // Build XML-structured prompt
  let prompt = `<system>
<identity>
Tu es ${role} dans Pennote, une application de prise de notes intelligente.
</identity>

<instructions>
${instructions}
</instructions>`;

  // User personalization section
  if (personalization && Object.keys(personalization).length > 0) {
    prompt += `

<user_profile>`;
    if (personalization.name) {
      prompt += `\n<name>${personalization.name}</name>`;
    }
    if (personalization.classe) {
      prompt += `\n<level>${personalization.classe}</level>`;
    }
    if (personalization.etude || personalization.filiere) {
      prompt += `\n<field>${personalization.etude || ""} ${personalization.filiere || ""}</field>`;
    }
    if (personalization.presentation) {
      prompt += `\n<bio>${personalization.presentation}</bio>`;
    }
    if (personalization.attente) {
      prompt += `\n<expectations>${personalization.attente}</expectations>`;
    }
    if (personalization.langue) {
      prompt += `\n<preferred_language>${personalization.langue}</preferred_language>`;
    }
    prompt += `
</user_profile>`;
  }

  // Sources section - CRITICAL for RAG
  if (ragSources && ragSources.length > 0) {
    prompt += `

<provided_sources>
<critical_instruction>
⚠️ ARRÊTE-TOI ET LIS CECI ATTENTIVEMENT ⚠️
L'utilisateur a EXPLICITEMENT attaché ${ragSources.length} source(s) à sa question.
Tu NE PEUX PAS répondre sans d'abord consulter ces sources avec les outils appropriés.
SI TU RÉPONDS SANS APPELER D'OUTIL, TA RÉPONSE SERA INCORRECTE.
</critical_instruction>

<sources_to_read>
${ragSources
  .map((s) => {
    if (s.type === "wikipedia" || s.id?.startsWith("wikipedia:")) {
      return `  <source type="wikipedia" action="APPELLE getWikipediaArticle avec title='${s.title}'">${s.title}</source>`;
    } else if (s.type === "page") {
      return `  <source type="page" action="APPELLE readWorkspacePage avec pageId='${s.id}'">${s.title}</source>`;
    } else {
      return `  <source type="file" action="APPELLE readRagSource avec sourceId='${s.id}'">${s.title}</source>`;
    }
  })
  .join("\n")}
</sources_to_read>

<mandatory_workflow>
1. PREMIÈRE ÉTAPE OBLIGATOIRE: Appeler l'outil approprié pour CHAQUE source listée ci-dessus
2. DEUXIÈME ÉTAPE: Lire et analyser le contenu retourné
3. TROISIÈME ÉTAPE: Répondre en te basant sur ce contenu
</mandatory_workflow>
</provided_sources>`;
  }

  // Conversation history
  if (conversationHistory) {
    prompt += `

<conversation_history>
${conversationHistory}
</conversation_history>`;
  }

  // Tool usage guidance - intelligent agent behavior
  prompt += `

<tools_available>
<description>Tu disposes de plusieurs outils pour répondre au mieux à l'utilisateur:</description>
<rag_tools>
- listAvailableSources: Liste les sources RAG disponibles
- searchRagChunks: Recherche dans les sources embedées (PDF, documents)
- readRagSource: Lit le contenu complet d'une source RAG
- checkSourcesRagStatus: Vérifie si les sources sont embedées
</rag_tools>
<workspace_tools>
- listWorkspacePages: Liste les pages du workspace
- readWorkspacePage: Lit le contenu d'une page
- listWorkspaceProjects: Liste les projets
</workspace_tools>
<page_tools>
- createPage: Crée une nouvelle page dans le workspace (utilisé en mode create)
- checkPageExists: Vérifie si une page existe toujours
</page_tools>
<web_tools>
- searchWeb: Recherche sur le web (actualités, informations récentes)
- searchWikipedia: Recherche d'articles Wikipedia
- getWikipediaArticle: Récupère le contenu complet d'un article Wikipedia
</web_tools>
<strategy>
1. PRIORITÉ: Si des sources sont explicitement fournies, LES CONSULTER EN PREMIER
2. Si les sources ne suffisent pas, chercher dans le workspace
3. Si toujours insuffisant, utiliser Wikipedia ou le web
4. OBJECTIF: Répondre de la manière la plus complète et précise possible
5. N'hésite PAS à utiliser plusieurs outils si nécessaire
</strategy>
</tools_available>

<formatting_rules>
<latex>
- Formules en ligne: $formule$
- Formules en bloc: $$formule$$
- NE JAMAIS utiliser \\( \\) ou \\[ \\]
</latex>
<markdown>
- Utilise le Markdown pour structurer tes réponses
- Titres, listes, gras, italique selon le besoin
</markdown>
<language>
- Réponds dans la langue de l'utilisateur (par défaut: français)
- Si l'utilisateur a une langue préférée, utilise-la
</language>
</formatting_rules>
</system>`;

  return prompt;
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
