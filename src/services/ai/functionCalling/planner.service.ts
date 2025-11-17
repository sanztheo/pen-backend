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
  conversationHistory?: string | null; // 🆕 Historique formaté de la conversation
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
      conversationHistory,
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
      const isWebOnlyMode = useWeb && !hasSpecificSources; // Mode web uniquement

      let contextualInstructions = "";

      // 🚀 NOUVEAU: ARCHITECTURE CURSOR-INSPIRED - MÉLANGE ÉQUITABLE DES SOURCES
      // Pas de hiérarchie, mais entrelacement intelligent

      // SCENARIO 0: Web only (no local sources)
      if (isWebOnlyMode) {
        contextualInstructions = `\n\nCONTEXT: Web-only mode is enabled. No local sources are available.

STRATEGY (WEB ONLY):
Focus on web searches with multiple angles. Call search_web 2-4 times with complementary queries.

Example for "Y Combinator":
- search_web: "Y Combinator startup accelerator history"
- search_web: "Y Combinator portfolio companies success"
- search_web: "Y Combinator application process"

Since no local sources exist, avoid calling list_available_sources.`;
      }
      // SCENARIO 1: Sources + Web (MÉLANGE ÉQUITABLE)
      else if (useWeb && hasSpecificSources) {
        const sourcesList = availableSources
          .map((s, i) => `   ${i + 1}. "${s.title}" (ID: ${s.id})`)
          .join("\n");
        contextualInstructions = `\n\nCONTEXT: User has selected ${availableSources.length} source(s) + web search enabled.

Sources provided:
${sourcesList}

🔥 STRATEGY (CURSOR-STYLE INTERLEAVED APPROACH):
MIX local sources and web searches EQUALLY - no hierarchy, balanced exploration.

INTERLEAVED PATTERN (example for 2 sources + web):
1. read_rag_source (source 1) - Local
2. search_web (angle 1) - Web enrichment
3. read_rag_source (source 2) - Local
4. search_web (angle 2) - Web complement

KEY PRINCIPLE: Alternate between local and web, don't do "all local then web" or "all web then local".
Think of it as WEAVING sources together, not stacking them.

The goal is to get a RICH, DIVERSE perspective by mixing both types equally.`;
      }
      // SCENARIO 2: All sources + Web (MÉLANGE ÉQUITABLE)
      else if (useWeb && isAllSourceMode) {
        contextualInstructions = `\n\nCONTEXT: Free exploration mode (all_source) + web search enabled.

🔥 STRATEGY (CURSOR-STYLE INTERLEAVED APPROACH):
MIX local sources and web searches EQUALLY throughout the exploration.

INTERLEAVED PATTERN (example):
1. list_available_sources - Discover local
2. search_web (angle 1) - Get web perspective
3. list_global_wikipedia_sources - Discover global
4. read_rag_source (best local) - Read local
5. search_web (angle 2) - Complement with web
6. search_rag_chunks - Deep dive local

KEY PRINCIPLE: WEAVE local and web together, don't prioritize one over the other.
Goal: Create a BALANCED mix of local knowledge and web information.`;
      }
      // SCENARIO 3: Sources seules (sans web)
      else if (hasSpecificSources && !useWeb) {
        const sourcesList = availableSources
          .map((s, i) => `   ${i + 1}. "${s.title}" (ID: ${s.id})`)
          .join("\n");
        contextualInstructions = `\n\nCONTEXT: User has selected ${availableSources.length} specific source(s) (web disabled).

Sources provided:
${sourcesList}

STRATEGY (LOCAL ONLY):
Read the provided sources directly. If insufficient, explore additional local sources.`;
      }
      // SCENARIO 4: All sources (sans web)
      else if (isAllSourceMode && !useWeb) {
        contextualInstructions = `\n\nCONTEXT: Free exploration mode (all_source) - web disabled.

STRATEGY (LOCAL EXPLORATION):
1. List available sources (personal + global Wikipedia)
2. Select and read the most relevant sources
3. Search within sources if needed`;
      }

      // Add useWeb instruction (simplifié)
      const useWebStr = useWeb
        ? `\n\n🌐 WEB SEARCH ENABLED:
IMPORTANT: Mix web searches WITH local sources throughout your plan.
Don't wait until the end to use web - INTERLEAVE it with local sources.
Each search_web should explore a complementary angle to local sources.`
        : "";

      // 🆕 Construire le contexte de l'historique si disponible
      const historyContext = conversationHistory
        ? `\n\n# CONVERSATION HISTORY (CONTEXT)\n\nYou have access to the previous conversation history. Use it to maintain context and continuity in your planning.\n\n${conversationHistory}\n\n# CURRENT QUERY\n\nThe user is now asking:`
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
            historyContext,
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
            historyContext,
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
        max_completion_tokens: isSearch ? 2500 : 1000, // SEARCH mode needs more tokens (10+ tools with detailed reasoning)
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

      const {
        toolSequence,
        optimizedQuery,
        reasoning,
        totalIterations,
        shouldUseTools,
      } = firstThinkingPlan.plan;

      // 🆕 Si l'AI décide de ne pas utiliser de tools, retourner un plan vide
      if (!shouldUseTools) {
        console.log(
          `🎯 [PLANNER] L'AI a décidé de ne pas utiliser de tools: ${reasoning}`,
        );
        return {
          toolSequence: [],
          optimizedQuery: query, // Pas de reformulation si pas de tools
          reasoning,
          totalIterations: 0,
          detectedMode,
        };
      }

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

      // VALIDATION DU PLAN COMPLET (nombre de tools selon le mode)
      // 🆕 Skip validation si pas de tools (shouldUseTools: false)
      let finalToolSequence = validatedToolSequence;

      if (validatedToolSequence.length > 0) {
        const hasPreselectedSources = availableSources.length > 0;
        const planValidation = ToolDependenciesValidator.validatePlan(
          validatedToolSequence.map((t) => ({ toolName: t.toolName })),
          detectedMode,
          hasPreselectedSources,
        );

        if (!planValidation.isValid) {
          console.error(
            `❌ [PLANNER] Plan invalide: ${planValidation.reasoning}`,
          );

          // 🔧 Si un plan corrigé est disponible, l'utiliser au lieu de bloquer
          if (
            planValidation.suggestedFix &&
            planValidation.suggestedFix.toolName === "PLAN_CORRECTION"
          ) {
            const correctedPlan = planValidation.suggestedFix.arguments
              .correctedPlan as Array<{ toolName: string; params?: any }>;

            console.log(
              `🔧 [PLANNER] Utilisation du plan corrigé automatiquement`,
            );
            console.log(
              `   Ancien: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
            );
            console.log(
              `   Nouveau: ${correctedPlan.map((t) => t.toolName).join(" → ")}`,
            );

            // Mapper le plan corrigé avec les détails complets
            finalToolSequence = correctedPlan.map((correctedTool, idx) => {
              // Retrouver le tool original pour garder ses paramètres
              const originalTool = validatedToolSequence.find(
                (t) => t.toolName === correctedTool.toolName,
              );
              return (
                originalTool || {
                  step: idx + 1,
                  toolName: correctedTool.toolName,
                  description: `Tool ${correctedTool.toolName}`,
                }
              );
            });
          } else {
            console.error(
              `   Suggestions: ${planValidation.missingDependencies?.join(", ")}`,
            );
            console.warn(
              `⚠️ [PLANNER] Poursuite malgré les erreurs de validation du plan`,
            );
          }
        }
      }

      return {
        toolSequence: finalToolSequence,
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
    historyContext: string = "",
  ): string {
    return `${historyContext}You need to create a structured JSON plan to explore a topic in depth.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

CRITICAL: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.
The validator will REJECT any plan with fewer than ${toolLimits.minTools} tools.

<tools>

<discovery>
list_available_sources: Lists ALL available sources (pages, files, personal Wikipedia).
  Returns: Source IDs and titles only, not content.
  Use when: Need to discover what sources exist before reading them.

list_global_wikipedia_sources: Lists GLOBAL shared Wikipedia sources.
  Returns: Wikipedia article titles and IDs only.
  Use when: Need access to Wikipedia knowledge base.

list_workspace_pages: Lists workspace pages only.
  Returns: Page titles and IDs.
  Use when: Need to explore user's workspace specifically.
</discovery>

<reading>
read_rag_source: READ COMPLETE FULL CONTENT of a source.
  Returns: Complete source text with full context.
  Use when: User asks "what is this about?", "summarize this", "what's the content?".
  Requires: Valid source ID from discovery tools.
  Example queries: "ca parle de quoi?", "resume cette page", "what is it about?".

search_rag_chunks: SEARCH for SPECIFIC information within sources.
  Returns: Relevant text fragments/excerpts only (NOT full content).
  Use when: Looking for specific facts, keywords, or targeted information.
  DO NOT use for: Questions about overall content or summaries.
  Example queries: "find X in the page", "search for Y", "where does it mention Z?".

select_relevant_sources: Filters sources by relevance to question.
  Returns: Subset of most relevant sources.
  Requires: Results from list_available_sources first.
  Use when: Too many sources to read, need to narrow down.

read_workspace_page: Reads complete workspace page content.
  Returns: Full page text.
  Scope: Workspace pages only (not files or Wikipedia).
</reading>

<external>
check_sources_rag_status: Checks if sources are indexed and ready.
  Returns: Status information only (not content).
  Use when: Need to validate source readiness before reading.

search_web: Web search for current information.
  Returns: Web search results.
  ${isWebOnlyMode ? "PRIMARY MODE: Use multiple times with different search angles." : "INTERLEAVED MODE: Mix with local sources equally, don't stack all web searches at end."}
  Requires API credits, slower than local sources.
</external>

</tools>

<strategy>
${
  isWebOnlyMode
    ? `
Web-only mode detected (no local sources available).

Approach:
- Use search_web MULTIPLE times (2-4 calls minimum)
- Each search explores different angle or aspect
- Vary search queries to get comprehensive coverage

Example for "Y Combinator":
  Step 1: search_web "Y Combinator startup accelerator history"
  Step 2: search_web "Y Combinator portfolio companies Airbnb Dropbox"
  Step 3: search_web "Y Combinator application process Demo Day"
`
    : `
Interleaved approach (mix local and web sources equally):

Pattern when all sources mode:
  1. list_available_sources (discover local)
  2. search_web (web perspective)
  3. list_global_wikipedia_sources (discover Wikipedia)
  4. read_rag_source (read best local)
  5. search_web (complement with web)
  6. search_rag_chunks (deep dive local)

Pattern when specific sources selected:
  1. read_rag_source (source 1)
  2. search_web (complementary angle)
  3. read_rag_source (source 2)
  4. search_web (different angle)

Key principle: Alternate local and web sources, do not stack them sequentially.
`
}
</strategy>

IMPORTANT:
${
  isWebOnlyMode
    ? `
- WEB ONLY MODE: Use multiple search_web calls
- Skip list_available_sources (no local sources)
- Each search_web explores a different angle
`
    : `
- INTERLEAVE local sources and web searches
- Don't do "all local first, then web" - MIX them!
- Think: Local → Web → Local → Web (weaving pattern)
- Each tool should add complementary information
- Never call read_rag_source with empty ID
`
}

# PLANNING
Start with a short checklist (3-7 conceptual steps) of what you will do to organize the resolution sequence before establishing the tool sequence.

# 📋 TOOL ORDER & DEPENDENCIES (IMPORTANT)

## Recommended Order (adapt based on context):
1. **Discovery Phase** (if needed):
   - list_available_sources → Discover what's available
   - list_global_wikipedia_sources → Check global knowledge
   - list_workspace_pages → Check workspace pages

2. **Selection Phase** (if sources discovered):
   - select_relevant_sources → Choose most relevant sources

3. **Reading Phase** (interleave with web if enabled):
   - read_rag_source → Read complete source content
   - search_rag_chunks → Search within sources
   - search_web → Get web perspective (INTERLEAVE, don't wait!)

## Dependency Rules (guidance, not strict):
- ✅ PREFERRED: list_available_sources BEFORE read_rag_source
- ✅ PREFERRED: select_relevant_sources AFTER list_available_sources
- ✅ AVOID: read_rag_source without knowing if sources exist
- ✅ FLEXIBLE: search_web can be used at ANY point (don't wait for end!)

## Important Notes:
- These are GUIDELINES to help you plan efficiently
- You can adapt the order based on the specific query
- If sources are pre-selected, skip discovery phase
- INTERLEAVE local and web searches (don't stack them!)

# GUIDELINES
${
  isWebOnlyMode
    ? `
WEB ONLY MODE (no local sources):
- Use: ONLY search_web (2-4 calls with varied queries)
- Avoid: list_available_sources, list_global_wikipedia_sources
- Each search_web explores a different angle
- Start DIRECTLY with search_web at step 1
`
    : `
🔥 INTERLEAVED MODE (Cursor-style):
- MIX local and web sources throughout the plan
- Pattern: Local → Web → Local → Web (not Local → Local → Web)
- NO hierarchy: treat local and web as EQUAL sources
- Goal: Create a WOVEN, BALANCED exploration${useWebStr}
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
    "totalIterations": <integer between 0 and 15>,
    "reasoning": "<short explanation of sequence choice OR why no tools are needed>",
    "optimizedQuery": "<REQUIRED REFORMULATION of user query to improve results, or original query if no tools>",
    "shouldUseTools": <boolean - true if tools needed, false for simple queries/greetings>,
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
      // ...other steps, INTERLEAVED if web enabled (mix local and web, no hierarchy)
      // EMPTY [] if shouldUseTools is false
    ],
    "errorHandling": {
      "emptySourceId": "Never call read_rag_source with empty ID. Check listed sources first.",
      "noSourcesFound": "If no sources found in all lists, use search_web."
    }
  }
}
\`\`\`

## 🆕 IMPORTANT: When to use shouldUseTools = false

Set \`shouldUseTools: false\` and \`toolSequence: []\` for:
- **Simple greetings**: "salut", "bonjour", "hello", "hi", "ça va?"
- **Thanks/acknowledgments**: "merci", "thanks", "ok", "d'accord"
- **Simple questions about you**: "qui es-tu?", "what are you?", "comment tu t'appelles?"
- **Trivial requests**: "test", "essai", requests that don't need external knowledge

Set \`shouldUseTools: true\` for:
- Knowledge questions requiring sources
- Requests to search, read, or analyze documents
- Complex queries needing external information

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
- 🔥 INTERLEAVE local and web sources if both enabled (no hierarchy, weave them)
- \`totalIterations\` MUST be at least ${toolLimits.minTools} tools in your plan
- Don't use \`read_rag_source\` without validated ID
- Mix different source types for balanced exploration`;
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
    historyContext: string = "",
  ): string {
    return `${historyContext}You need to create a SIMPLE JSON plan for QUICK ASK mode.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

IMPORTANT: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.

<tools>

list_available_sources: Lists available sources.
  Returns: Titles and IDs only.

read_rag_source: READ COMPLETE FULL CONTENT.
  Use when: User asks what a page is about, wants summary, needs full understanding.
  Returns: Complete source text.
  Example queries: "ca parle de quoi?", "resume cette page", "what is it about?".

  PARAMS FORMAT (CRITICAL):
  {
    "sourceId": "uuid-string",
    "query": "what is this about?"
  }

  IMPORTANT: Use "sourceId" NOT "source_id".

search_rag_chunks: SEARCH for SPECIFIC excerpts.
  Use when: Looking for specific facts or keywords.
  Returns: Relevant fragments only (NOT full content).
  DO NOT use for: Summary or "what is it about" questions.
  Example queries: "find X", "search for Y", "where is Z mentioned?".

  PARAMS FORMAT (CRITICAL):
  {
    "query": "search terms here"
  }

  IMPORTANT: Use "query" NOT "search_query".

search_web: Web search (if enabled).
  Returns: Current web information.
  Note: Slower, costs credits.

</tools>

<decision_tree>

If user asks WHAT content is about:
  Questions: "ca parle de quoi?", "resume", "what's in this?", "c'est quoi le contenu?".
  Tool: read_rag_source (reads full content).
  DO NOT use: search_rag_chunks (returns fragments only).

If user wants to FIND specific information:
  Questions: "trouve X", "cherche Y", "where is Z?".
  Tool: search_rag_chunks (fast targeted search).
  DO NOT use: read_rag_source (unnecessarily slow).

</decision_tree>

# QUICK MODE STRATEGY (1-3 tools max)
${
  hasSpecificSources && useWeb
    ? `🔥 Sources + Web enabled:
→ MIX local and web (1-2 tools each)
→ Example: search_rag_chunks + search_web (balanced)
→ NO hierarchy, just quick balanced check`
    : hasSpecificSources
      ? `Specific sources provided → Call \`search_rag_chunks\` to find info quickly`
      : useWeb && availableSources.length === 0
        ? `WEB ONLY MODE:
→ NO local sources, use \`search_web\` DIRECTLY
→ Single \`search_web\` call is enough
→ If user asks "web search", use as FIRST tool

Example: "Y Combinator info from web"
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
          ? `🔥 All sources + Web enabled:
→ MIX local and web (1-2 tools each)
→ Example: list_available_sources + search_web (balanced)
→ Don't do "all local then web", INTERLEAVE them`
          : `No web → Quick local search
→ Call \`list_available_sources\` then \`search_rag_chunks\``
}

QUICK MODE: Maximum 3 tools, favor speed over comprehensiveness.

## JSON Schema (REQUIRED)

CRITICAL: The "params" field is REQUIRED for each tool in toolSequence!

\`\`\`json
{
  "plan": {
    "totalIterations": <0 to 3>,
    "reasoning": "<short explanation OR why no tools needed>",
    "optimizedQuery": "<query reformulation for better results, or original if no tools>",
    "shouldUseTools": <boolean - true if tools needed, false for simple queries/greetings>,
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
      // EMPTY [] if shouldUseTools is false
    ]
  }
}
\`\`\`

## 🆕 IMPORTANT: When NOT to use tools (shouldUseTools = false)

Set \`shouldUseTools: false\` and \`toolSequence: []\` for:
- **Simple greetings**: "salut", "bonjour", "hello", "hi", "ça va?", "comment ça va?"
- **Thanks/acknowledgments**: "merci", "thanks", "ok", "d'accord", "parfait"
- **Simple questions about you**: "qui es-tu?", "what are you?", "c'est quoi ton nom?"
- **Trivial requests**: "test", "essai", requests that don't require external knowledge

In these cases, respond directly without tools. Tools should only be used for knowledge-seeking queries.

${sourcesContext}${contextualInstructions}${useWebStr}

Question: "${query}"

GENERATE the JSON plan NOW. Maximum 3 tools. No text before or after the JSON.`;
  }
}
