/**
 * Planner Service - First Thinking (Planning Phase)
 *
 * Ce service est responsable de la génération du plan d'exécution initial
 * basé sur la requête utilisateur et les sources disponibles.
 *
 * Il génère un plan JSON structuré avec:
 * - Une séquence de tools à exécuter
 * - Une query optimisée
 * - Un raisonnement expliquant la stratégie
 */

import { AIService } from "../base.js";
import { ToolDependenciesValidator } from "./toolDependencies.js";
import {
  isFirstThinkingPlan,
  type FirstThinkingPlan,
} from "../../../types/ragThinking.js";
import { parseJSONFromStream } from "./utils/jsonParser.js";

/**
 * Request parameters for plan generation
 */
export interface PlanRequest {
  query: string;
  availableSources: Array<{
    id: string;
    title: string;
    type: string;
  }>;
  workspaceId: string;
  userId: string;
  isSearch: boolean;
  useWeb: boolean;
  systemPrompt?: string;
  onThinking?: (content: string) => void;
}

/**
 * Tool step in the execution plan
 */
export interface ToolStep {
  step: number;
  toolName: string;
  description: string;
  params?: any;
}

/**
 * Generated execution plan
 */
export interface Plan {
  toolSequence: ToolStep[];
  optimizedQuery: string;
  reasoning: string;
  totalIterations: number;
  detectedMode: "ask" | "search" | "create_rapide" | "create_profond";
}

/**
 * Service for generating execution plans (First Thinking)
 */
export class PlannerService {
  /**
   * Génère un plan d'exécution basé sur la requête utilisateur
   *
   * Ce plan contient:
   * - La séquence de tools à exécuter
   * - Une query optimisée pour améliorer les résultats
   * - Le raisonnement derrière la stratégie choisie
   * - Le nombre total d'itérations
   *
   * @param request - Paramètres de la requête
   * @returns Plan d'exécution structuré
   */
  static async generatePlan(request: PlanRequest): Promise<Plan> {
    const {
      query,
      availableSources,
      isSearch = false,
      useWeb,
      onThinking,
    } = request;

    // 🆕 DÉTECTION DU MODE (ask, search, create_rapide, create_profond)
    const detectedMode = ToolDependenciesValidator.detectMode(query, isSearch);
    const toolLimits = ToolDependenciesValidator.getToolLimits(detectedMode);

    console.log(
      `🔧 [PLANNER] Mode détecté: ${detectedMode} (${toolLimits.minTools}-${toolLimits.maxTools} tools, recommandé: ${toolLimits.recommended})`,
    );
    console.log(
      `🔧 [PLANNER] Génération du plan avec ${availableSources.length} sources disponibles`,
    );

    const openai = AIService.getOpenAI();

    try {
      // 🔥 ÉTAPE 1: First Thinking - Generate JSON plan with tool sequence
      console.log(`💭 [PLANNER] Génération first thinking avec plan JSON...`);

      const sourcesContext =
        availableSources.length > 0
          ? `Sources disponibles:\n${availableSources.map((s, i) => `${i + 1}. "${s.title}" (ID: ${s.id}, Type: ${s.type})`).join("\n")}`
          : "Aucune source spécifique disponible";

      // 🎯 CONTEXTE ADAPTATIF: Détecter le scénario pour adapter les instructions
      const hasWorkspacePages = availableSources.some(
        (s) => s.type === "WORKSPACE_PAGE",
      );
      const hasSpecificSources = availableSources.length > 0;
      const isAllSourceMode = !hasSpecificSources; // Mode all_source si aucune source spécifique
      const isWebOnlyMode = useWeb && !hasSpecificSources; // 🔥 NEW: Mode web uniquement

      let contextualInstructions = "";

      // SCENARIO 0: Web only (no local sources)
      if (isWebOnlyMode) {
        contextualInstructions = `\n\nCONTEXT: Web-only mode is enabled. No local sources are available.

SUGGESTED STRATEGY:
Focus your research on web searches. You should call search_web multiple times with different angles to build comprehensive understanding.
Prefer to vary your queries to get complementary perspectives rather than repeating similar searches.

Example multi-search approach for "Y Combinator":
- First search: "Y Combinator startup accelerator history"
- Second search: "Y Combinator portfolio companies success stories"
- Third search: "Y Combinator application process requirements"

Since no local sources exist, avoid calling list_available_sources or select_relevant_sources.
Each search_web call should explore a different aspect of the topic.`;
      }
      // SCENARIO 1: Single specific source
      else if (hasSpecificSources && availableSources.length === 1) {
        contextualInstructions = `\n\nCONTEXT: The user has selected a specific source.

SUGGESTED STRATEGY:
Start by reading this source with read_rag_source (ID: ${availableSources[0].id}).
After reading, assess whether the information sufficiently addresses the query.
If the information appears incomplete, you may optionally explore additional sources using list_available_sources or search_web.

The user's source selection should be prioritized, but you have flexibility to gather supplementary information if needed.`;
      }
      // SCÉNARIO 2: Multiple sources spécifiques
      else if (hasSpecificSources && availableSources.length > 1) {
        const sourcesList = availableSources
          .map((s, i) => `   ${i + 1}. "${s.title}" (ID: ${s.id})`)
          .join("\n");
        contextualInstructions = `\n\nCONTEXT: The user has pre-selected ${availableSources.length} specific sources.

Sources provided:
${sourcesList}

SUGGESTED STRATEGY:
Since the user has already selected specific sources, prefer to read those sources directly rather than searching for additional sources.
You should bias towards calling read_rag_source for each provided source (${availableSources.length} calls total).
Avoid calling list_available_sources or select_relevant_sources as the selection has already been made.
If after reading all provided sources the information appears insufficient, you may optionally call search_web or explore additional sources.

Note: The user's source selection should be respected, but you have flexibility to gather additional information if needed after reading the provided sources.`;
      }
      // SCÉNARIO 3: all_source (exploration libre)
      else if (isAllSourceMode) {
        contextualInstructions = `\n\nCONTEXT: Free exploration mode (all_source) - No specific sources selected.

RECOMMENDED STRATEGY (COMPLETE EXPLORATION):
1. DISCOVERY: Start by listing ALL available sources
   - Call "list_available_sources" for personal sources
   - Call "list_global_wikipedia_sources" for global Wikipedia sources
2. SELECTION: Identify the most relevant sources for the question
3. READING: Read the 2-3 best sources with "read_rag_source"
4. ENRICHMENT: If ${useWeb ? 'web enabled, use "search_web" to complete' : "needed, search in other sources"}

NOTE: Complete exploration mode - explore all available options.`;
      }

      // Add useWeb instruction with adaptive priority
      const useWebStr = useWeb
        ? `\n\nWEB SEARCH AVAILABLE:
${
  hasSpecificSources
    ? 'You can use "search_web" to enrich the selected sources if needed.'
    : 'You can use "search_web" after exploring local sources, or before if you think web search will be more relevant.'
}

Adaptive approach based on scores:
- If local sources provide good score (>0.7) → Web search optional
- If local sources provide medium score (0.4-0.7) → Web search recommended
- If local sources provide low score (<0.4) → Web search strongly recommended`
        : "";

      const firstThinkingPrompt = isSearch
        ? this.buildSearchModePrompt(
            query,
            detectedMode,
            toolLimits,
            sourcesContext,
            contextualInstructions,
            useWebStr,
            isWebOnlyMode,
          )
        : this.buildAskModePrompt(
            query,
            detectedMode,
            toolLimits,
            sourcesContext,
            contextualInstructions,
            useWebStr,
            hasSpecificSources,
            useWeb,
            availableSources,
          );

      let firstThinkingContent = "";
      const firstThinkingStream = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          {
            role: "system",
            content:
              "You are an expert AI assistant specialized in query analysis and tool orchestration. Generate valid JSON plans without emojis or decorative symbols. Focus on precise, structured planning with clear reasoning.",
          },
          {
            role: "user",
            content: firstThinkingPrompt,
          },
        ],
        temperature: 0.2, // Lower temperature for more consistent planning
        max_completion_tokens: 1000, // GPT-5 uses max_completion_tokens instead of max_tokens
        stream: true,
        response_format: { type: "json_object" } as any, // JSON MODE STRICT
      });

      // Collecter le contenu du premier thinking
      for await (const chunk of firstThinkingStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          firstThinkingContent += delta.content;
          if (onThinking) {
            onThinking(delta.content);
          }
        }
      }

      console.log(
        `✅ [PLANNER] First thinking généré: ${firstThinkingContent.length} chars`,
      );

      // Parse first thinking JSON
      const firstThinkingPlan = parseJSONFromStream(firstThinkingContent);
      if (!isFirstThinkingPlan(firstThinkingPlan)) {
        console.warn(
          "⚠️ First thinking plan invalid, falling back to no tools",
        );
        // 🔥 FIX: En mode rapide (isSearch=false), accepter un plan vide et continuer sans tools
        if (!isSearch) {
          console.log(
            "🔧 [PLANNER] Mode rapide détecté, continuing sans tools",
          );
          throw new Error(
            "No valid plan generated - in quick mode, this is acceptable",
          );
        }
        // En mode search, un plan invalide est une erreur
        throw new Error("Invalid first thinking plan format");
      }

      const { toolSequence, optimizedQuery, reasoning, totalIterations } =
        firstThinkingPlan.plan;

      // 🎯 Extraire la query optimisée du plan (ou fallback sur query originale)
      const queryToUse =
        optimizedQuery &&
        typeof optimizedQuery === "string" &&
        optimizedQuery.trim().length > 0
          ? optimizedQuery
          : query;

      if (optimizedQuery && optimizedQuery !== query) {
        console.log(`🎯 [QUERY-OPTIMIZATION] Query reformulée:`);
        console.log(`   Original: "${query.slice(0, 100)}"`);
        console.log(`   Optimisée: "${optimizedQuery.slice(0, 100)}"`);
      }

      // 🔥 Valider les tools: ne garder que les tools valides
      const VALID_TOOLS = [
        "list_available_sources",
        "select_relevant_sources",
        "check_sources_rag_status",
        "read_rag_source",
        "search_rag_chunks",
        "search_web",
        "read_workspace_page",
        "list_workspace_pages",
        "list_global_wikipedia_sources",
      ];
      const validatedToolSequence = toolSequence.filter((t) =>
        VALID_TOOLS.includes(t.toolName),
      );

      if (validatedToolSequence.length === 0) {
        console.warn("⚠️ Aucun tool valide dans le plan");
        throw new Error("No valid tools in plan");
      }

      console.log(
        `🔧 [PLANNER] Plan validé: ${validatedToolSequence.length} tools valides, tools: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
      );

      // 🆕 VALIDATION DU PLAN COMPLET (nombre de tools selon le mode)
      const planValidation = ToolDependenciesValidator.validatePlan(
        validatedToolSequence.map((t) => ({ toolName: t.toolName })),
        detectedMode,
      );

      if (!planValidation.isValid) {
        console.error(
          `❌ [PLANNER] Plan invalide: ${planValidation.reasoning}`,
        );
        console.error(
          `   Suggestions: ${planValidation.missingDependencies?.join(", ")}`,
        );

        // En mode strict, on pourrait bloquer ici
        // Pour l'instant, on continue avec un warning
        console.warn(
          `⚠️ [PLANNER] Poursuite malgré les erreurs de validation du plan`,
        );
      }

      return {
        toolSequence: validatedToolSequence,
        optimizedQuery: queryToUse,
        reasoning,
        totalIterations,
        detectedMode,
      };
    } catch (error) {
      console.error(`❌ [PLANNER] Erreur génération plan:`, error);
      throw error;
    }
  }

  /**
   * Construit le prompt pour le mode Search (exploration approfondie)
   */
  private static buildSearchModePrompt(
    query: string,
    detectedMode: string,
    toolLimits: { minTools: number; maxTools: number; recommended: number },
    sourcesContext: string,
    contextualInstructions: string,
    useWebStr: string,
    isWebOnlyMode: boolean,
  ): string {
    return `You need to create a structured JSON plan to explore a topic in depth.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

CRITICAL: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.
The validator will REJECT any plan with fewer than ${toolLimits.minTools} tools.

# AVAILABLE TOOLS (by category)

## LIST SOURCES
- \`list_available_sources\`: Lists ALL available sources (pages, files, personal Wikipedia)
- \`list_global_wikipedia_sources\`: Lists GLOBAL shared Wikipedia sources (before \`search_web\`)
- \`list_workspace_pages\`: Lists workspace pages

## READ/SEARCH IN SOURCES
- \`read_rag_source\`: Reads the complete content of ONE RAG source
- \`select_relevant_sources\`: Selects relevant sources for the question
- \`search_rag_chunks\`: Semantic search WITHIN RAG sources
- \`read_workspace_page\`: Reads a specific workspace page

## EXTERNAL
- \`check_sources_rag_status\`: Checks RAG status of sources (requires source IDs)
- \`search_web\`: Web search ${isWebOnlyMode ? "(PRIMARY TOOL - use MULTIPLE TIMES with different angles)" : "(last resort)"}

# SUGGESTED STRATEGY (Search Mode - deep exploration)
${
  isWebOnlyMode
    ? `
WEB ONLY MODE DETECTED: No local sources selected
→ Use "search_web" MULTIPLE TIMES (2-4 calls) with different angles to explore the topic in depth
→ Vary your queries to get complementary perspectives
→ Skip listing sources (no local sources available)

Example plan for "Tell me about Y Combinator":
1. search_web: "Y Combinator startup accelerator history founders"
2. search_web: "Y Combinator portfolio companies unicorns success"
3. search_web: "Y Combinator application process funding model"
4. search_web (optional): "Y Combinator Demo Day investor network"
`
    : `
1. Call \`list_available_sources\`, then \`list_global_wikipedia_sources\` → get complete list of sources (personal + global)
2. Use \`select_relevant_sources\` OR \`read_rag_source\` to explore relevant sources
3. Use \`search_rag_chunks\` to search for specific information in sources
4. If information remains insufficient, use \`search_web\` OR \`check_sources_rag_status\`
`
}

IMPORTANT:
${
  isWebOnlyMode
    ? `
- WEB ONLY MODE: Jump directly to multiple "search_web" calls
- Avoid calling list_available_sources or list_global_wikipedia_sources (no local sources)
- Focus on 2-4 search_web calls with complementary queries
- Each search_web should explore a different angle of the topic
`
    : `
- Start with \`list_available_sources\` THEN \`list_global_wikipedia_sources\`, in that order
- If \`list_available_sources\` returns empty, still call \`list_global_wikipedia_sources\` to check global Wikipedia
- Never call \`read_rag_source\` with an empty ID - always check listed sources first
- If no sources found anywhere, use \`search_web\`
`
}

# PLANNING
Start with a short checklist (3-7 conceptual steps) of what you will do to organize the resolution sequence before establishing the tool sequence.

# GUIDELINES
${
  isWebOnlyMode
    ? `
WEB ONLY MODE (no local sources selected):
- Avoid: list_available_sources, list_global_wikipedia_sources, select_relevant_sources
- Use: ONLY search_web (2-4 calls with varied queries)
- Each search_web should explore a different angle of the topic
- Start DIRECTLY with search_web at step 1
`
    : `
HYBRID MODE (local sources available):
- Start with list_available_sources THEN list_global_wikipedia_sources
- Then select_relevant_sources OR read_rag_source to explore
- search_web only if local sources are insufficient${useWebStr}
`
}
- You should reformulate the user query for ALL tools that accept "query" or "question" parameters
- Query optimization: Fix spelling, enrich with keywords, make vague queries more precise
- Each tool should be different and complementary at each step
- \`totalIterations\`: MUST be at least ${toolLimits.minTools} (minimum required), recommended ${toolLimits.recommended}, maximum ${toolLimits.maxTools}
- If you use \`check_sources_rag_status\`, first retrieve the source IDs
- Use only the tools listed above; for read and consultation operations, you can call automatically; for any state change or destructive operation, require explicit confirmation before execution
- Before calling any important tool, briefly indicate why you're calling it and the minimal parameters used

# STRICT JSON STRUCTURE (all fields are required)

\`\`\`json
{
  "plan": {
    "totalIterations": <integer between 1 and 15>,
    "reasoning": "<short explanation of sequence choice>",
    "optimizedQuery": "<REQUIRED REFORMULATION of user query to improve results>",
    "toolSequence": [
      {
        "step": <integer>,
        "toolName": "<tool name>",
        "description": "<brief action description>",
        "params": {
          // REQUIRED for search_web: {"query": "optimized search query"}
          // REQUIRED for read_rag_source: {"sourceId": "...", "query": "..."}
          // REQUIRED for select_relevant_sources: {"question": "...", "availableSources": [...]}
          // For other tools, can be empty {} if no params needed
        }
      }
      // ...other steps, always in prescribed order (start with \`list_available_sources\` then \`list_global_wikipedia_sources\`)
    ],
    "errorHandling": {
      "emptySourceId": "Never call read_rag_source with empty ID. Check listed sources first.",
      "noSourcesFound": "If no sources found in all lists, use search_web."
    }
  }
}
\`\`\`

REQUIRED FIELD - optimizedQuery:
This field MUST contain a reformulated and optimized version of the user query.
This optimized query will be automatically used for the first tools (list_available_sources, select_relevant_sources, etc.).

Reformulation example:
- User query: "fait une analyse sur le web sur pythagore"
- optimizedQuery: "Pythagorean theorem: definition, mathematical proof and geometric applications"

After planning and sequencing, validate that each tool is well justified in the sequence and the output schema is strictly respected.

${sourcesContext}${contextualInstructions}${useWebStr}

Question: "${query}"

GENERATE the JSON plan NOW. No text before or after the JSON.

## Output format
- The JSON plan must strictly respect the schema above
- Tools always in prescribed order at start: \`list_available_sources\`, then \`list_global_wikipedia_sources\`
- \`totalIterations\` MUST be at least ${toolLimits.minTools} tools in your plan
- Don't use \`read_rag_source\` without validated ID
- If no sources found, include \`search_web\` as fallback in sequence`;
  }

  /**
   * Construit le prompt pour le mode Ask (réponse rapide)
   */
  private static buildAskModePrompt(
    query: string,
    detectedMode: string,
    toolLimits: { minTools: number; maxTools: number; recommended: number },
    sourcesContext: string,
    contextualInstructions: string,
    useWebStr: string,
    hasSpecificSources: boolean,
    useWeb: boolean,
    availableSources: Array<{ id: string; title: string; type: string }>,
  ): string {
    return `You need to create a SIMPLE JSON plan for QUICK ASK mode.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

IMPORTANT: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.

# SIMPLIFIED AVAILABLE TOOLS

## BASIC EXPLORATION
- \`list_available_sources\`: Lists available sources
- \`search_rag_chunks\`: Quick search in sources

## WEB (IF ENABLED)
- \`search_web\`: Quick web search

# QUICK MODE STRATEGY (1-3 tools max)
${
  hasSpecificSources
    ? `Specific sources provided → Call \`search_rag_chunks\` with query to find info quickly`
    : useWeb && availableSources.length === 0
      ? `QUICK MODE + WEB ONLY DETECTED
→ NO local sources available, use \`search_web\` DIRECTLY (skip listing sources)
→ Speed focus: 1 single \`search_web\` is enough to get essential info
→ If user asks "look on the web" or "web search", use \`search_web\` as FIRST tool

Example for "Create welcome page for Y Combinator, look on the web":
{
  "toolSequence": [
    {
      "step": 1,
      "toolName": "search_web",
      "description": "Search who is Y Combinator and their mission",
      "params": {
        "query": "Y Combinator startup accelerator history mission founders"
      }
    }
  ]
}`
      : useWeb
        ? `No specific sources → Start with \`list_available_sources\` then \`search_web\` if needed`
        : `No specific sources, no web → Call \`list_available_sources\` then \`search_rag_chunks\``
}

QUICK MODE: Maximum 3 tools, favor speed over comprehensiveness.

## JSON Schema (REQUIRED)

CRITICAL: The "params" field is REQUIRED for each tool in toolSequence!

\`\`\`json
{
  "plan": {
    "totalIterations": <1 to 3>,
    "reasoning": "<short explanation>",
    "optimizedQuery": "<query reformulation for better results>",
    "toolSequence": [
      {
        "step": 1,
        "toolName": "<tool_name>",
        "description": "<action>",
        "params": {
          // REQUIRED: For search_web, you MUST include {"query": "optimized search string"}
          // For other tools, provide appropriate params or {} if none needed
        }
      }
    ]
  }
}
\`\`\`

${sourcesContext}${contextualInstructions}${useWebStr}

Question: "${query}"

GENERATE the JSON plan NOW. Maximum 3 tools. No text before or after the JSON.`;
  }
}
