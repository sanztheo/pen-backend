/**
 * Phase 1 : Décision et exécution des tools
 *
 * Ce service implémente une boucle agentic avec un système de thinking basé sur JSON :
 * - First thinking : génère un plan JSON avec la séquence de tools
 * - Intermediate thinking : génère du JSON avec les arguments pour chaque tool
 * - Les tools s'exécutent avec les arguments dérivés du thinking intermédiaire
 */

import { AIService } from "../../base.js";
import { ToolExecutor, type ToolContext } from "../../tools/executors.js";
import {
  isFirstThinkingPlan,
  isIntermediateThinkingOutput,
  IntermediateThinkingBlock,
} from "../../../../types/ragThinking.js";
import { parseJSONFromStream } from "../utils/jsonParser.js";
import { ToolCallRecord } from "../types/common.types.js";
import type {
  DecideToolsOptions,
  DecideToolsResult,
} from "../types/phase1.types.js";
import { CoordinatorService } from "../coordinator.service.js";
import { ScoringService, type ToolResultScore } from "../scoring.service.js";
import {
  ToolDependenciesValidator,
  type ToolExecutionContext,
} from "../toolDependencies.js";

/**
 * Service pour la Phase 1 : Décision et exécution des tools
 */
export class Phase1Service {
  /**
   * 🔥 REFACTORED: Agentic loop with JSON-based thinking system
   * - First thinking generates a JSON plan with tool sequence
   * - Each intermediate thinking generates JSON with tool arguments
   * - Tools execute with arguments derived from intermediate thinking
   */
  static async decideAndExecuteTools(
    options: DecideToolsOptions,
  ): Promise<DecideToolsResult> {
    const {
      query,
      availableSources,
      workspaceId,
      userId,
      useWeb,
      systemPrompt,
      isSearch = false,
      onThinking,
      onToolCall,
      onToolResult,
      onIntermediateThinking,
    } = options;

    const toolCalls: ToolCallRecord[] = [];
    const intermediateThinkingBlocks: IntermediateThinkingBlock[] = [];
    let thinking = "";
    const context: ToolContext = { userId, workspaceId };

    // 🆕 DÉTECTION DU MODE (ask, search, create_rapide, create_profond)
    const detectedMode = ToolDependenciesValidator.detectMode(query, isSearch);
    const toolLimits = ToolDependenciesValidator.getToolLimits(detectedMode);

    console.log(
      `🔧 [PHASE-1] Mode détecté: ${detectedMode} (${toolLimits.minTools}-${toolLimits.maxTools} tools, recommandé: ${toolLimits.recommended})`,
    );
    console.log(
      `🔧 [PHASE-1] Boucle agentic refactorisée avec ${availableSources.length} sources disponibles`,
    );

    const openai = AIService.getOpenAI();
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    try {
      // 🔥 ÉTAPE 1: First Thinking - Generate JSON plan with tool sequence
      console.log(`💭 [PHASE-1] Génération first thinking avec plan JSON...`);

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
      // 🎯 SCÉNARIO 3: all_source (exploration libre)
      else if (isAllSourceMode) {
        contextualInstructions = `\n\n📌 CONTEXTE: Mode exploration libre (all_source) - Aucune source spécifique.

🎯 STRATÉGIE RECOMMANDÉE (EXPLORATION COMPLÈTE) :
1. **DÉCOUVERTE**: Commence par lister TOUTES les sources disponibles
   - Appelle "list_available_sources" pour les sources personnelles
   - Appelle "list_global_wikipedia_sources" pour les sources Wikipedia globales
2. **SÉLECTION**: Identifie les sources les plus pertinentes pour la question
3. **LECTURE**: Lis les 2-3 meilleures sources avec "read_rag_source"
4. **ENRICHISSEMENT**: Si ${useWeb ? 'web activé, utilise "search_web" pour compléter' : "besoin, cherche dans d'autres sources"}

⚠️ NOTE: Mode exploration complète - explore toutes les options disponibles.`;
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
        ? `You need to create a structured JSON plan to explore a topic in depth.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

⚠️ CRITICAL: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.
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
    "totalIterations": <integer between 1 and 8>,
    "reasoning": "<short explanation of sequence choice>",
    "optimizedQuery": "<REQUIRED REFORMULATION of user query to improve results>",
    "toolSequence": [
      {
        "step": <integer>,
        "toolName": "<tool name>",
        "description": "<brief action description>",
        "params": {
          // Optional: parameters like sourceId (if required by tool)
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
- If no sources found, include \`search_web\` as fallback in sequence`
        : `You need to create a SIMPLE JSON plan for QUICK ASK mode.

# MODE REQUIREMENTS: ${detectedMode.toUpperCase()}
- Minimum tools required: ${toolLimits.minTools}
- Maximum tools allowed: ${toolLimits.maxTools}
- Recommended number: ${toolLimits.recommended}

⚠️ IMPORTANT: Your plan MUST include at least ${toolLimits.minTools} tools to be valid.

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
      "description": "Search who is Y Combinator and their mission"
    }
  ]
}`
      : useWeb
        ? `No specific sources → Start with \`list_available_sources\` then \`search_web\` if needed`
        : `No specific sources, no web → Call \`list_available_sources\` then \`search_rag_chunks\``
}

QUICK MODE: Maximum 3 tools, favor speed over comprehensiveness.

## JSON Schema (REQUIRED)

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
        "description": "<action>"
      }
    ]
  }
}
\`\`\`

${sourcesContext}${contextualInstructions}${useWebStr}

Question: "${query}"

GENERATE the JSON plan NOW. Maximum 3 tools. No text before or after the JSON.`;

      let firstThinkingContent = "";
      const firstThinkingStream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert in query structuring. You generate ONLY valid JSON, without additional text.",
          },
          {
            role: "user",
            content: firstThinkingPrompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 800, // Increased to allow optimizedQuery + complete plan
        stream: true,
        response_format: { type: "json_object" } as any, // 🔥 JSON MODE STRICT
      });

      // Collecter le contenu du premier thinking
      for await (const chunk of firstThinkingStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          firstThinkingContent += delta.content;
          thinking += delta.content;
          if (onThinking) {
            onThinking(delta.content);
          }
        }
      }

      console.log(
        `✅ [PHASE-1] First thinking généré: ${firstThinkingContent.length} chars`,
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
            "🔧 [PHASE-1] Mode rapide détecté, continuing sans tools",
          );
          return {
            shouldUseTools: false,
            toolCalls: [],
            thinking: firstThinkingContent,
            intermediateThinkingBlocks: [],
          };
        }
        // En mode search, un plan invalide est une erreur
        throw new Error("Invalid first thinking plan format");
      }

      const { toolSequence, optimizedQuery } = firstThinkingPlan.plan;

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
      ];
      const validatedToolSequence = toolSequence.filter((t) =>
        VALID_TOOLS.includes(t.toolName),
      );

      if (validatedToolSequence.length === 0) {
        console.warn("⚠️ Aucun tool valide dans le plan");
        throw new Error("No valid tools in plan");
      }

      console.log(
        `🔧 [PHASE-1] Plan validé: ${validatedToolSequence.length} tools valides, tools: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
      );

      // 🆕 VALIDATION DU PLAN COMPLET (dépendances + mode)
      const planValidation = CoordinatorService.validateFullPlan(
        validatedToolSequence.map((t) => ({ toolName: t.toolName })),
        detectedMode,
      );

      if (!planValidation.isValid) {
        console.error(
          `❌ [PHASE-1] Plan invalide: ${planValidation.reasoning}`,
        );
        console.error(
          `   Suggestions: ${planValidation.missingDependencies?.join(", ")}`,
        );

        // En mode strict, on pourrait bloquer ici
        // Pour l'instant, on continue avec un warning
        console.warn(
          `⚠️ [PHASE-1] Poursuite malgré les erreurs de validation du plan`,
        );
      }

      await sleep(150);

      // 🔥 ÉTAPE 2: Agentic loop - Execute tools with arguments from intermediate thinking
      const initialMessages: any[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `${sourcesContext}${contextualInstructions}\n\nQuestion: "${query}"`,
        },
      ];

      // 🔥 Déclarer toolArgs AVANT la boucle pour garder les arguments du thinking intermédiaire
      let toolArgs: any = {};
      // 🔥 NEW: Store extracted sources from tool results for reuse
      let extractedSources: any[] = [];

      // Exécuter chaque tool selon le plan (la séquence peut grandir dynamiquement via improvement logic)
      for (
        let iterationIdx = 0;
        iterationIdx < validatedToolSequence.length;
        iterationIdx++
      ) {
        const toolStep = validatedToolSequence[iterationIdx];
        if (!toolStep) break;

        console.log(
          `🔧 [PHASE-1-ITER-${iterationIdx + 1}/${validatedToolSequence.length}] Exécution: ${toolStep.toolName} - ${toolStep.description}`,
        );

        // 🔥 RÉINITIALISER toolArgs SEULEMENT pour le premier tool
        if (iterationIdx === 0) {
          // 🔥 Premier tool: utiliser la query optimisée du plan
          toolArgs = { query: queryToUse };

          // Si c'est read_rag_source et que des sources sont disponibles, passer le premier sourceId
          if (
            toolStep.toolName === "read_rag_source" &&
            availableSources.length > 0
          ) {
            toolArgs.sourceId = availableSources[0].id;
          }
        }
        // Pour les itérations suivantes, toolArgs contient déjà les arguments du thinking précédent

        // 🔥 ÉTAPE 2B: Stream the tool call
        if (onToolCall) {
          onToolCall(toolStep.toolName, toolArgs);
        }

        await sleep(50);

        // 🔥 ÉTAPE 2C: Execute tool
        const result = await ToolExecutor.executeToolCall(
          toolStep.toolName,
          toolArgs,
          context,
        );

        // 🔥 Recovery intelligent pour erreurs UUID
        this.handleUUIDErrorRecovery(
          result,
          toolStep,
          validatedToolSequence,
          iterationIdx,
        );

        // 🔥 NEW: Extract available sources from list_available_sources or list_global_wikipedia_sources results
        if (
          (toolStep.toolName === "list_available_sources" ||
            toolStep.toolName === "list_global_wikipedia_sources") &&
          result &&
          !result.startsWith("❌") &&
          !result.startsWith("Aucune")
        ) {
          try {
            // Parse source listings from the result (format: "ID: XXX")
            const sourceMatches = result.match(/ID: ([a-f0-9\-]+)/g);
            if (sourceMatches) {
              sourceMatches.forEach((match: string) => {
                const id = match.replace("ID: ", "");
                // Parse the title from the line above
                const lines = result.split("\n");
                const matchIdx = lines.findIndex((line) =>
                  line.includes(match),
                );
                if (matchIdx > 0) {
                  const titleLine = lines[matchIdx - 3] || "";
                  const titleMatch = titleLine.match(/\d+\.\s*\[.+?\]\s*(.+)/);
                  const title = titleMatch ? titleMatch[1] : "Unknown";

                  const typeLineIdx = lines.findIndex(
                    (line, idx) =>
                      idx > matchIdx - 3 && line.startsWith("   Type:"),
                  );
                  const typeMatch =
                    typeLineIdx >= 0
                      ? lines[typeLineIdx].match(/Type:\s*(.+)/)
                      : null;
                  const sourceType = typeMatch
                    ? typeMatch[1].trim()
                    : "WIKIPEDIA";

                  if (!extractedSources.find((s) => s.id === id)) {
                    extractedSources.push({ id, title, sourceType });
                  }
                }
              });
              console.log(
                `🔄 [PHASE-1] Extracted ${extractedSources.length} sources from ${toolStep.toolName}`,
              );
            }
          } catch (parseError) {
            console.warn(
              `⚠️ [PHASE-1] Failed to extract sources from ${toolStep.toolName} result:`,
              parseError,
            );
          }
        }

        // Stream tool result
        if (onToolResult) {
          onToolResult(toolStep.toolName, result);
        }

        await sleep(50);

        // 🎯 SCORING: Évaluer la qualité du résultat (observe → adjust → continue)
        const resultScore = await ScoringService.scoreToolResult({
          toolName: toolStep.toolName,
          result,
          query: queryToUse,
          expectedInfo: toolStep.description,
          context: {
            previousScores: toolCalls
              .map((tc) => tc.score)
              .filter((s) => s !== undefined) as ToolResultScore[],
            useWeb,
            hasSpecificSource: availableSources.length > 0,
            mode: isSearch ? "search" : "ask",
          },
        });

        console.log(
          `📊 [PHASE-1-SCORE] ${toolStep.toolName}: ${resultScore.overallScore.toFixed(2)} (conf=${resultScore.confidence.toFixed(2)}, rel=${resultScore.relevance.toFixed(2)}, comp=${resultScore.completeness.toFixed(2)})`,
        );
        if (resultScore.suggestions.length > 0) {
          console.log(`💡 [PHASE-1-SUGGESTIONS]:`, resultScore.suggestions);
        }

        // Enregistrer le tool call avec son score
        toolCalls.push({
          name: toolStep.toolName,
          arguments: toolArgs,
          result,
          score: resultScore, // 🆕 NOUVEAU : score pour audit
          timestamp: Date.now(),
        });

        // Ajouter à l'historique des messages
        initialMessages.push({
          role: "user",
          content: `Tool ${toolStep.toolName} résultat:\n${result}`,
        });

        console.log(
          `✅ [PHASE-1-ITER-${iterationIdx + 1}] Complété: ${toolStep.toolName}`,
        );

        // 🔄 FEEDBACK LOOP: Ajuster la stratégie en fonction des scores (observe → adjust → continue)
        const strategyAdjustment = await ScoringService.adjustStrategy(
          toolCalls.map((tc) => ({
            name: tc.name,
            score: tc.score,
            result: tc.result,
          })),
          queryToUse,
          {
            useWeb,
            availableSourcesCount: availableSources.length,
            hasSpecificSource: availableSources.length > 0,
            mode: isSearch ? "search" : "ask",
          },
        );

        console.log(`🔄 [STRATEGY-ADJUST] ${strategyAdjustment.reasoning}`);
        console.log(
          `   shouldExploreMore: ${strategyAdjustment.shouldExploreMore}, shouldUseWeb: ${strategyAdjustment.shouldUseWeb}, shouldStop: ${strategyAdjustment.shouldStop}`,
        );
        console.log(
          `   Priority: ${strategyAdjustment.priority}, Confidence: ${strategyAdjustment.confidence.toFixed(2)}`,
        );

        // 🔥 NOUVEAU: CURSOR-LIKE IMPROVEMENT - Agir sur les scores faibles (pas juste logger)
        // ⚠️ LIMITES: Max 15 iterations totales, max 3 tools ajoutés, respecter mode Web Only
        const MAX_ITERATIONS = 15;
        const MAX_IMPROVEMENTS = 3;
        const RECENT_TOOL_WINDOW = 3;

        // Compter combien de tools ont été ajoutés via IMPROVEMENT
        const improvementsAdded = validatedToolSequence.filter((t) =>
          t.description?.includes("Amélioration qualité"),
        ).length;

        // 🔥 FIX: En mode Web Only, BLOQUER les suggestions de tools locaux
        const allowedToolsInWebOnly = ["search_web"];
        let filteredSuggestedTools = strategyAdjustment.suggestedTools;

        if (isWebOnlyMode) {
          filteredSuggestedTools = strategyAdjustment.suggestedTools.filter(
            (toolName) => allowedToolsInWebOnly.includes(toolName),
          );

          if (
            filteredSuggestedTools.length <
            strategyAdjustment.suggestedTools.length
          ) {
            console.log(
              `🌐 [WEB-ONLY] Filtrage des tools locaux: ${strategyAdjustment.suggestedTools.join(", ")} → ${filteredSuggestedTools.join(", ")}`,
            );
          }
        }

        // Si les scores sont faibles ET que la stratégie recommande fortement d'explorer
        if (
          (strategyAdjustment.priority === "high" ||
            strategyAdjustment.priority === "critical") &&
          filteredSuggestedTools.length > 0 &&
          resultScore.overallScore < 0.6 &&
          validatedToolSequence.length < MAX_ITERATIONS &&
          improvementsAdded < MAX_IMPROVEMENTS // 🔥 FIX: Limite d'améliorations
        ) {
          console.log(
            `🔥 [IMPROVEMENT] Score faible détecté (${resultScore.overallScore.toFixed(2)}), ajout de tools pour amélioration (${improvementsAdded}/${MAX_IMPROVEMENTS})...`,
          );

          // Dynamiquement ajouter les tools suggérés à la fin du plan
          for (const suggestedToolName of filteredSuggestedTools) {
            if (improvementsAdded >= MAX_IMPROVEMENTS) {
              console.log(
                `⏹️ [IMPROVEMENT] Limite MAX_IMPROVEMENTS (${MAX_IMPROVEMENTS}) atteinte`,
              );
              break;
            }

            // 🔥 FIX: Vérifier si le tool n'est pas dans le plan restant OU dans les N dernières itérations
            const alreadyPlanned = validatedToolSequence
              .slice(iterationIdx + 1)
              .some((t) => t.toolName === suggestedToolName);

            const recentlyExecuted = validatedToolSequence
              .slice(
                Math.max(0, iterationIdx - RECENT_TOOL_WINDOW + 1),
                iterationIdx + 1,
              )
              .some((t) => t.toolName === suggestedToolName);

            if (
              !alreadyPlanned &&
              !recentlyExecuted &&
              validatedToolSequence.length < MAX_ITERATIONS
            ) {
              validatedToolSequence.push({
                step: validatedToolSequence.length + 1,
                toolName: suggestedToolName,
                description: `Amélioration qualité: ${strategyAdjustment.reasoning}`,
              });
              console.log(
                `✅ [IMPROVEMENT] Ajout de "${suggestedToolName}" pour améliorer la qualité (${improvementsAdded + 1}/${MAX_IMPROVEMENTS})`,
              );
            } else if (recentlyExecuted) {
              console.log(
                `⏭️ [IMPROVEMENT] Skip "${suggestedToolName}" (exécuté récemment dans les ${RECENT_TOOL_WINDOW} dernières iters)`,
              );
            }
          }

          // Augmenter totalIterations pour prendre en compte les nouveaux tools
          console.log(
            `🔄 [IMPROVEMENT] Nouvelle séquence: ${validatedToolSequence.map((t) => t.toolName).join(" → ")}`,
          );
        } else if (validatedToolSequence.length >= MAX_ITERATIONS) {
          console.log(
            `⏹️ [IMPROVEMENT] Limite MAX_ITERATIONS (${MAX_ITERATIONS}) atteinte, arrêt de l'amélioration`,
          );
        } else if (improvementsAdded >= MAX_IMPROVEMENTS) {
          console.log(
            `⏹️ [IMPROVEMENT] Limite MAX_IMPROVEMENTS (${MAX_IMPROVEMENTS}) atteinte`,
          );
        }

        // 🔥 PHILOSOPHIE: Le scoring est une INDICATION, pas une règle absolue
        // On continue l'exploration jusqu'au nombre de tools recommandé, même si le score est bon
        const hasReachedRecommendedTools =
          toolCalls.length >= toolLimits.recommended;

        if (
          strategyAdjustment.shouldStop &&
          strategyAdjustment.confidence > 0.8 &&
          hasReachedRecommendedTools
        ) {
          console.log(
            `⏹️ [STRATEGY-ADJUST] Arrêt acceptable: ${toolCalls.length}/${toolLimits.recommended} tools recommandés atteints (score: ${resultScore.overallScore.toFixed(2)})`,
          );
          // Ne pas arrêter brutalement, laisser l'IA décider dans le thinking intermédiaire
        } else if (
          strategyAdjustment.shouldStop &&
          !hasReachedRecommendedTools
        ) {
          console.log(
            `🔄 [STRATEGY-ADJUST] Score bon mais continue exploration: ${toolCalls.length}/${toolLimits.recommended} tools (le scoring n'est qu'une indication)`,
          );
        }

        // 🔥 ÉTAPE 2D: Générer les arguments du tool SUIVANT via intermediate thinking (après exécution du tool actuel)
        const nextIterationIdx = iterationIdx + 1;
        if (
          nextIterationIdx < validatedToolSequence.length &&
          onIntermediateThinking
        ) {
          const nextToolStep = validatedToolSequence[nextIterationIdx];

          // 🔥 CRITICAL: Si nextToolStep n'existe pas (plan a été modifié), arrêter la boucle
          if (!nextToolStep) {
            console.log(
              `⏹️ [PHASE-1-ITER-${iterationIdx + 1}] Pas de tool suivant après modification du plan, fin de la boucle`,
            );
            break;
          }

          console.log(
            `🧠 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Génération des arguments pour ${nextToolStep.toolName}...`,
          );

          try {
            // 🔥 NEW: Build tool execution history with scores + track search_web queries
            const previousWebQueries = toolCalls
              .filter((tc) => tc.name === "search_web")
              .map((tc) => tc.arguments?.query || "")
              .filter((q) => q.length > 0);

            const executedTools = toolCalls
              .map((tc, idx) => {
                const score = tc.score
                  ? ` (score: ${tc.score.overallScore.toFixed(2)})`
                  : "";
                const args =
                  tc.name === "search_web" && tc.arguments?.query
                    ? ` avec query: "${tc.arguments.query}"`
                    : "";
                return `${idx + 1}. ${tc.name}${score}${args}`;
              })
              .join("\n");
            const remainingTools = validatedToolSequence
              .slice(iterationIdx + 1)
              .map((t) => `- ${t.toolName}`)
              .join("\n");

            // FEEDBACK LOOP: Integrate strategic recommendations in prompt
            const strategyRecommendation = `
CURRENT STRATEGY EVALUATION (based on scores):
${strategyAdjustment.reasoning}

ADAPTIVE RECOMMENDATIONS:
- Explore more sources? ${strategyAdjustment.shouldExploreMore ? "Yes" : "No"}
- Use search_web? ${strategyAdjustment.shouldUseWeb ? "Yes (priority: " + strategyAdjustment.priority + ")" : "No"}
- Stop (sufficient info)? ${strategyAdjustment.shouldStop ? "Yes (confidence: " + strategyAdjustment.confidence.toFixed(2) + ")" : "No"}
${strategyAdjustment.suggestedTools.length > 0 ? "- Suggested tools: " + strategyAdjustment.suggestedTools.join(", ") : ""}

NOTE: These recommendations are based on results analysis. You can follow them or adapt based on question context.`;

            // Add useWeb flag and web instruction with adaptive priority
            const webInstruction = useWeb
              ? `\nWEB SEARCH AVAILABLE: ${
                  strategyAdjustment.shouldUseWeb
                    ? `Strategy strongly recommends using search_web (priority: ${strategyAdjustment.priority})`
                    : "Web search is available if needed to enrich"
                }`
              : "";

            const intermediateThinkingPrompt = `You received results. Analyze them and determine the next step.

${strategyRecommendation}

Before any decision, start with a concise checklist (3-7 conceptual points) describing the steps to consider based on received data.

ORIGINAL QUESTION: "${query}"

TOOLS ALREADY EXECUTED:
${executedTools || "None"}

${
  previousWebQueries.length > 0
    ? `
WEB QUERIES ALREADY USED (DO NOT REPEAT):
${previousWebQueries.map((q, i) => `${i + 1}. "${q}"`).join("\n")}

IMPORTANT for next search_web:
You MUST explore a TOTALLY DIFFERENT angle. Examples of alternative angles:
- If already searched "history" → search "portfolio companies" or "funding model"
- If already searched "overview" → search "success stories" or "application process"
- If already searched "founders" → search "Demo Day" or "notable alumni"
`
    : ""
}

REMAINING TOOLS IN PLAN:
${remainingTools || "None"}

IMPORTANT - READ ACTUAL RESULTS:
Previous results are recorded in context above (result of Tool X).
- If a tool returns "No sources" → It's REAL, there are no sources of that type
- If a tool returns a list → COUNT sources and select the BEST ones
- NEVER INVENT sources! Use ONLY those listed in previous results
- If NO tool found sources → You MUST call the NEXT tool in the plan

INTELLIGENT STRATEGY (NOT STRICT):

CORE RULE - QUERY OPTIMIZATION:
   → Never use the raw user question directly if it's poorly formulated
   → FIX spelling errors ("parle mo ide theoremes" → "mathematical theorems")
   → IMPROVE clarity ("explain" → "definition properties applications")
   → ADD relevant keywords for better results

1. IF global Wikipedia sources have been LISTED but NOT YET READ:
   → Select the BEST ones (2-3 max) relevant to the question
   → Don't try to read everything (e.g., if 1000 sources, choose the 3 most relevant)
   → READ them to extract key information with an OPTIMIZED query
   → AFTER reading: decide if you need web search to complete

2. HOW TO CHOOSE THE BEST SOURCES?
   - Read the TITLES of listed sources
   - Select those that MATCH MOST closely to your question
   - Use read_rag_source with the BEST IDs (not all IDs)
   - Example for "tell me about theorems":
     Best: "Thales Theorem" (highly relevant)
     Good: "Pythagorean Theorem" (relevant)
     Consider: "Law of cosines" (relevant but secondary - evaluate)

3. IF you have ALREADY READ selected sources:
   → Evaluate if the answer is SUFFICIENT for the question
   → Sufficient? → shouldContinue: false (AI will generate final answer)
   → Incomplete? → You can optionally complete with search_web if web is enabled

4. PHILOSOPHY:
   - Local sources (global Wikipedia) = PRIORITY (it's free + fast)
   - INTELLIGENT SELECTION: Choose 2-3 sources max, not everything
   - Web = TO ENRICH, not replace local sources
   - Example: Read the 2 main theorems in Wikipedia, then search for modern use cases on web

WEB STRATEGY:
- ${useWeb ? "WEB ENABLED: You can use search_web to COMPLETE existing sources" : "WEB DISABLED: Stay only on local sources"}
- search_web should not be the first option, but an optional enrichment
- If local sources cover the question: no need for web

TOOL ARGUMENTS:

CORE RULE - REQUIRED QUERY OPTIMIZATION:
For ALL tools that accept "query" or "question", you MUST systematically improve/reformulate the user query to maximize result relevance:
  - Correct spelling and grammar errors
  - Make vague queries more precise and targeted
  - Add relevant and contextual keywords
  - Structure query to optimize semantic search
  - Translate or clarify ambiguous terms

Reformulation examples:
  Bad: "fait une analyse sur le web sur pythagore"
  Good: "Pythagorean theorem: definition, mathematical proof and applications"

  Bad: "parle mo ide theoremes"
  Good: "fundamental mathematical theorems geometry algebra"

  Bad: "c koi la loi newton"
  Good: "Newton's laws classical mechanics physics fundamental principles"

For list_available_sources:
  - Include: "query": "${query}" (REFORMULATED AND OPTIMIZED)
  - Required: Always reformulate user query to improve search results
  - Example: {"query": "Pythagorean theorem mathematical applications geometry"}

For select_relevant_sources:
  - Always include: "question": "${query}" (REFORMULATED AND OPTIMIZED)
  - Always include: "availableSources": Array of objects {id, title, sourceType} EXTRACTED from list_available_sources results
  - Required: Use EXACT IDs (UUID format) found in list_available_sources results
  - Critical: NEVER INVENT IDs! Use ONLY IDs present in results (e.g., "a0395ed4-a69f-4d70-bef5-7e19f7d9098d")
  - Bad: {"id": "wiki_7266", ...} (invented ID)
  - Good: {"id": "a0395ed4-a69f-4d70-bef5-7e19f7d9098d", ...} (real ID extracted from results)
  - Example: {"question": "definition and mathematical proofs of Pythagorean theorem", "availableSources": [{"id": "a0395ed4-a69f-4d70-bef5-7e19f7d9098d", "title": "Pythagorean Theorem", "sourceType": "WIKIPEDIA"}]}

For read_rag_source:
  - Include: "sourceId": The ID of a found source
  - Include: "query": Search query in source (REFORMULATED string)
  - Required: Reformulate to precisely target information sought in source
  - Example: {"sourceId": "123", "query": "mathematical proof and use cases of theorem"}

For search_rag_chunks:
  - Include: "query": Semantic search query (REFORMULATED AND OPTIMIZED string)
  - Required: Optimize for efficient vector semantic search
  - Optionally include: "sourceIds": Array of IDs if you want to search in specific sources
  - Example: {"query": "geometric proofs right triangle Pythagoras", "sourceIds": ["123"]}

For search_web:
  - Important: This tool takes ONLY "query" (string), NOT "question" nor "availableSources" nor "maxResults"
  - Include: "query": "web search string" (REFORMULATED AND ENRICHED string)
  - Required: Reformulate and enrich query with relevant keywords for web
  - Multi-search: If you ALREADY called search_web, you MUST explore a TOTALLY DIFFERENT ANGLE
  - Never repeat same query or similar variants
  - Example first search: {"query": "Y Combinator startup accelerator history founders"}
  - Example second search: {"query": "Y Combinator portfolio companies unicorns Airbnb Dropbox Stripe"}
  - Example third search: {"query": "Y Combinator application process Demo Day funding model"}

DECISION:
After each tool call or edit, validate in 1-2 lines the adequacy of the result with the expected step, and decide if a correction is needed or if you continue the sequence.
Return STRICTLY a JSON object with the following structure (keys must be in exact order below):
- "thinking": Your reflection on results and next step (string)
- "shouldContinue": true or false (boolean)
- "nextToolName": Indicates next tool if shouldContinue is true (string or null)
- "toolArguments": Specifies arguments to provide to next tool (object, specific structure per tool)
- "modifiedToolSequence" (optional): Array with modified tool sequence if you want to change plan (array)

CRITICAL CONSISTENCY RULE:
- If your "thinking" says "I will read sources" → "nextToolName" MUST be "read_rag_source"
- If your "thinking" says "I will select" → "nextToolName" MUST be "select_relevant_sources"
- If your "thinking" says "I will search web" → "nextToolName" MUST be "search_web"
- Never say one thing in thinking and do another in nextToolName
- A Coordinator will verify consistency and BLOCK inconsistencies

DECISION EXAMPLES:

Example 1 - Wikipedia listed with select_relevant_sources (WITH REFORMULATION AND REAL IDS):
{
  "thinking": "Found 3 Wikipedia sources in results. I reformulate 'tell me about theorems' to 'fundamental mathematical theorems definitions applications' and use EXACT UUID IDs extracted from list_available_sources results.",
  "shouldContinue": true,
  "nextToolName": "select_relevant_sources",
  "toolArguments": {
    "question": "fundamental mathematical theorems definitions applications",
    "availableSources": [
      {"id": "6a14f726-aa93-47f5-9d90-ae2304493e44", "title": "Thales Theorem", "sourceType": "WIKIPEDIA"},
      {"id": "a0395ed4-a69f-4d70-bef5-7e19f7d9098d", "title": "Pythagorean Theorem", "sourceType": "WIKIPEDIA"},
      {"id": "28fc1ad2-dfc8-4afe-9d15-64f0bbc1c5e7", "title": "Law of cosines", "sourceType": "WIKIPEDIA"}
    ]
  }
}

Example 2 - Wikipedia listed, read best one (WITH REFORMULATION):
{
  "thinking": "Listed sources. Reading Pythagoras with optimized query to target key information.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "6f9280e9-a4ba-43ae-8372-698efd22fa84", "query": "mathematical proof right triangle geometric applications"}
}

Example 3 - Wikipedia read, sufficient info:
{
  "thinking": "Read 2 main theorems (Thales and Pythagoras). They cover well the fundamental concepts requested.",
  "shouldContinue": false,
  "modifiedToolSequence": []
}

Example 4 - Wikipedia partially read, want to enrich with web (WITH ENRICHED REFORMULATION):
{
  "thinking": "Read Thales and Pythagoras. Searching web with keyword-enriched query to find other fundamental theorems.",
  "shouldContinue": true,
  "nextToolName": "search_web",
  "toolArguments": {"query": "fundamental mathematical theorems geometry algebra course proofs"}
}

Example 5 - Correcting poorly formulated query (REQUIRED REFORMULATION):
{
  "thinking": "Question 'parle mo ide theoremes' is poorly formulated. I correct it to 'fundamental mathematical theorems' for effective search.",
  "shouldContinue": true,
  "nextToolName": "read_rag_source",
  "toolArguments": {"sourceId": "abc-123", "query": "definition properties applications mathematical theorems"}
}

## Output format

Response must be STRICTLY a JSON object with FOLLOWING keys, in this order (all except modifiedToolSequence are required):
1. "thinking" (string)
2. "shouldContinue" (boolean)
3. "nextToolName" (string or null)
4. "toolArguments" (object, type depends on tool)
5. "modifiedToolSequence" (optional, array)

Example schema:
{
  "thinking": "<reasoning>",
  "shouldContinue": true,
  "nextToolName": "<tool_name>",
  "toolArguments": { ... },
  "modifiedToolSequence": [ ... ]
}

The "toolArguments" field must match the structure expected by the tool (see examples above). All fields except "modifiedToolSequence" are REQUIRED in each response unless shouldContinue is false: in that case, "nextToolName" and "toolArguments" can be omitted or null. Output MUST contain NO text outside the JSON object.${webInstruction}`; //

            let intermediateThinkingContent = "";
            const intermediateStream = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                ...initialMessages,
                {
                  role: "user",
                  content: intermediateThinkingPrompt,
                },
              ],
              temperature: 0.3,
              max_tokens: 400,
              stream: true,
              response_format: { type: "json_object" } as any, // 🔥 JSON MODE STRICT
            });

            // Streamer le thinking intermédiaire
            for await (const chunk of intermediateStream) {
              const delta = chunk.choices[0]?.delta;
              if (delta?.content) {
                intermediateThinkingContent += delta.content;
                onIntermediateThinking(delta.content);
              }
            }

            // Parser intermediate thinking JSON
            const intermediateParsed = parseJSONFromStream(
              intermediateThinkingContent,
            );
            if (isIntermediateThinkingOutput(intermediateParsed)) {
              // 🔥 NEW: Check if AI wants to modify the plan
              if (
                intermediateParsed.modifiedToolSequence &&
                intermediateParsed.modifiedToolSequence.length > 0
              ) {
                console.log(
                  `🔄 [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Plan modifié! Nouvelle séquence:`,
                  intermediateParsed.modifiedToolSequence
                    .map((t: any) => t.toolName)
                    .join(" → "),
                );

                // 🎯 COORDINATOR: Valider la modification de plan
                const originalPlanNames = validatedToolSequence
                  .slice(iterationIdx + 1)
                  .map((t) => t.toolName);
                const modifiedPlanNames =
                  intermediateParsed.modifiedToolSequence.map(
                    (t: any) => t.toolName,
                  );
                const lastResult =
                  toolCalls[toolCalls.length - 1]?.result || "";

                const planValidation =
                  await CoordinatorService.validatePlanModification(
                    originalPlanNames,
                    modifiedPlanNames,
                    lastResult,
                    intermediateParsed.thinking,
                  );

                if (!planValidation.isValid) {
                  console.warn(
                    `❌ [COORDINATOR] Modification de plan REFUSÉE: ${planValidation.reasoning}`,
                  );
                  console.log(
                    `🔄 [COORDINATOR] Poursuite avec le plan original`,
                  );
                  // Ne pas modifier le plan, continuer avec le plan original
                } else {
                  console.log(
                    `✅ [COORDINATOR] Modification de plan VALIDÉE: ${planValidation.reasoning}`,
                  );
                  // Remplacer le reste du plan avec le nouveau plan
                  const newSequence = intermediateParsed.modifiedToolSequence;
                  // Supprimer les tools déjà exécutés du nouveau plan
                  for (
                    let i = validatedToolSequence.length - 1;
                    i > iterationIdx;
                    i--
                  ) {
                    validatedToolSequence.pop();
                  }
                  // Ajouter les nouveaux tools
                  for (const newTool of newSequence) {
                    validatedToolSequence.push(newTool);
                  }
                  console.log(
                    `✅ Nouveau nombre total d'itérations: ${validatedToolSequence.length}`,
                  );
                }

                // 🔥 IMPORTANT: Si on a modifié le plan, on doit CONTINUER même si shouldContinue est false
                // Sinon on ne va jamais exécuter le nouveau plan!
              } else if (intermediateParsed.shouldContinue === false) {
                // 🔥 NEW: Check if AI wants to stop the loop (SEULEMENT si pas de modifiedToolSequence)
                console.log(
                  `⏹️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] IA a décidé d'arrêter la boucle`,
                );
                intermediateThinkingBlocks.push({
                  iteration: iterationIdx,
                  thinking: intermediateParsed.thinking,
                  toolArguments: {},
                  generatedAt: new Date().toISOString(),
                  nextToolName: "STOP",
                  score: resultScore, // 🆕 Score du résultat du dernier tool
                  strategyAdjustment: strategyAdjustment.reasoning, // 🆕 Raison de l'arrêt
                });
                break; // Arrêter la boucle agentic
              }

              toolArgs = intermediateParsed.toolArguments || {};

              // 🎯 COORDINATOR: Valider la cohérence thinking/action AVANT d'exécuter
              const previousResults = toolCalls.map((tc) => tc.result);

              // 🆕 Construire le contexte d'exécution avec extractedSources
              const executionContext: ToolExecutionContext = {
                executedTools: toolCalls.map((tc) => ({
                  name: tc.name,
                  arguments: tc.arguments,
                  result: tc.result,
                })),
                extractedSources: extractedSources,
              };

              const coordinatorValidation =
                await CoordinatorService.validateCoherence({
                  thinking: intermediateParsed.thinking,
                  nextToolName: nextToolStep.toolName,
                  toolArguments: toolArgs,
                  previousToolResults: previousResults,
                  originalPlan: validatedToolSequence.map((t) => t.toolName),
                  executionContext: executionContext, // 🆕 Passer le contexte avec extractedSources
                });

              if (!coordinatorValidation.isValid) {
                console.warn(
                  `❌ [COORDINATOR] Incohérence détectée: ${coordinatorValidation.reasoning}`,
                );

                // 🔥 PRIORISATION: Si une correction est disponible, l'appliquer au lieu de bloquer
                if (coordinatorValidation.correctedToolName) {
                  console.log(
                    `🔧 [COORDINATOR] Correction AUTO appliquée (type Cursor): ${nextToolStep.toolName} → ${coordinatorValidation.correctedToolName}`,
                  );

                  // Créer un nouveau step avec le tool corrigé
                  nextToolStep.toolName =
                    coordinatorValidation.correctedToolName;
                  nextToolStep.description = `Correction auto: ${coordinatorValidation.reasoning}`;

                  if (coordinatorValidation.correctedArguments) {
                    toolArgs = coordinatorValidation.correctedArguments;
                    console.log(
                      `🔧 [COORDINATOR] Arguments corrigés:`,
                      toolArgs,
                    );
                  }

                  // 🔥 Si le tool corrigé est read_rag_source, vérifier que query est fourni
                  if (
                    coordinatorValidation.correctedToolName ===
                      "read_rag_source" &&
                    !toolArgs.query
                  ) {
                    // 🎯 OPTIMISATION: Générer une query spécifique à la source au lieu d'utiliser la query brute
                    const sourceToRead = extractedSources.find(
                      (s) => s.id === toolArgs.sourceId,
                    );
                    if (sourceToRead) {
                      // Générer une query optimisée basée sur le titre de la source
                      toolArgs.query = `définition, propriétés, formules et applications de ${sourceToRead.title.toLowerCase()}`;
                      console.log(
                        `🔧 [COORDINATOR] Query optimisée générée pour read_rag_source: ${toolArgs.query}`,
                      );
                    } else {
                      // Fallback: utiliser la query originale si la source n'est pas trouvée
                      toolArgs.query = query;
                      console.log(
                        `🔧 [COORDINATOR] Query fallback ajoutée pour read_rag_source: ${query}`,
                      );
                    }
                  }
                } else if (coordinatorValidation.shouldBlock) {
                  // Bloquer SEULEMENT si aucune correction n'est possible
                  console.error(
                    `🚫 [COORDINATOR] Exécution BLOQUÉE (aucune correction disponible)`,
                  );
                  intermediateThinkingBlocks.push({
                    iteration: iterationIdx,
                    thinking: `[COORDINATOR BLOCK] ${coordinatorValidation.reasoning}`,
                    toolArguments: {},
                    generatedAt: new Date().toISOString(),
                    nextToolName: "BLOCKED",
                    score: resultScore, // 🆕 Score du résultat du dernier tool
                    strategyAdjustment: "Exécution bloquée par le Coordinator", // 🆕 Raison du blocage
                  });
                  break; // Arrêter la boucle
                } else {
                  console.warn(
                    `⚠️ [COORDINATOR] Incohérence détectée mais pas de correction - poursuite`,
                  );
                }
              } else {
                console.log(
                  `✅ [COORDINATOR] Plan cohérent: ${coordinatorValidation.reasoning}`,
                );
              }

              // Sauvegarder le bloc avec l'itération du TOOL ACTUELLEMENT EXÉCUTÉ
              intermediateThinkingBlocks.push({
                iteration: iterationIdx, // 🔥 Itération du tool ACTUEL (après lequel ce thinking est généré)
                thinking: intermediateParsed.thinking,
                toolArguments: toolArgs,
                generatedAt: new Date().toISOString(),
                nextToolName: nextToolStep.toolName, // 🔥 Le PROCHAIN tool
                score: resultScore, // 🆕 Score du résultat du tool actuel
                strategyAdjustment: strategyAdjustment.reasoning, // 🆕 Recommandations de stratégie
              });

              // 🔥 NEW: Ensure select_relevant_sources has required arguments
              if (nextToolStep.toolName === "select_relevant_sources") {
                // Add question if missing
                if (!toolArgs.question) {
                  toolArgs.question = query;
                  console.log(
                    `🔧 [INTERMEDIATE-THINKING] Added missing 'question' to select_relevant_sources`,
                  );
                }

                // Add availableSources if missing
                if (
                  !toolArgs.availableSources ||
                  !Array.isArray(toolArgs.availableSources) ||
                  toolArgs.availableSources.length === 0
                ) {
                  if (extractedSources.length > 0) {
                    toolArgs.availableSources = extractedSources;
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Added extracted sources (${extractedSources.length}) to select_relevant_sources`,
                    );
                  } else {
                    console.warn(
                      `⚠️ [INTERMEDIATE-THINKING] No extracted sources available for select_relevant_sources`,
                    );
                  }
                }
              }

              // 🔥 NEW: Ensure search_web has required 'query' argument (string) - NO maxResults (controlled by OpenAI)
              if (nextToolStep.toolName === "search_web") {
                // Validation: search_web needs 'query' (string), not 'question' or 'availableSources' or 'maxResults'
                if (!toolArgs.query || typeof toolArgs.query !== "string") {
                  // If IA provided wrong arguments (like 'question' or 'availableSources'), fix it
                  if (
                    toolArgs.question &&
                    typeof toolArgs.question === "string"
                  ) {
                    toolArgs = { query: toolArgs.question };
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Fixed search_web arguments: converted 'question' to 'query'`,
                    );
                  } else {
                    // Fallback: use original query
                    toolArgs = { query };
                    console.log(
                      `🔧 [INTERMEDIATE-THINKING] Fixed search_web arguments: using original query`,
                    );
                  }
                } else {
                  // Clean up any extra fields that don't belong to search_web (including maxResults)
                  toolArgs = { query: toolArgs.query };
                  console.log(
                    `🔧 [INTERMEDIATE-THINKING] Cleaned search_web arguments`,
                  );
                }
              }

              console.log(
                `✅ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Arguments extraits:`,
                toolArgs,
              );
            } else {
              console.warn(
                `⚠️ Invalid intermediate thinking format after iteration ${iterationIdx}`,
              );
            }
          } catch (error) {
            console.warn(
              `⚠️ [INTERMEDIATE-THINKING-AFTER-${iterationIdx}] Erreur:`,
              error,
            );
            // Fallback: utiliser la description comme query
            toolArgs = { query: nextToolStep.description };
          }

          await sleep(50);
        }
      }

      console.log(
        `✅ [PHASE-1] Tous les tools exécutés: ${toolCalls.length} total`,
      );

      return {
        toolCalls,
        thinking,
        shouldUseTools: toolCalls.length > 0,
        intermediateThinkingBlocks,
      };
    } catch (error) {
      console.error(`❌ [PHASE-1] Erreur boucle agentic:`, error);
      throw error;
    }
  }

  /**
   * 🔄 Gère la récupération intelligente en cas d'erreur UUID
   */
  private static handleUUIDErrorRecovery(
    result: string,
    toolStep: any,
    validatedToolSequence: any[],
    iterationIdx: number,
  ): void {
    const hasUUIDError =
      result.includes("Invalid UUID") ||
      result.includes("Inconsistent column data") ||
      result.includes("invalid character");
    const isReadRAGFailure =
      toolStep.toolName === "read_rag_source" && result.startsWith("❌");

    if (hasUUIDError && isReadRAGFailure) {
      console.log(
        `🔄 [UUID-RECOVERY] Erreur UUID détectée, injection list_available_sources pour recovery`,
      );

      const hasListInPlan = validatedToolSequence.some(
        (t) => t.toolName === "list_available_sources",
      );

      if (!hasListInPlan && validatedToolSequence.length < 10) {
        validatedToolSequence.splice(iterationIdx + 1, 0, {
          step: iterationIdx + 2,
          toolName: "list_available_sources",
          description: "Recovery: Lister sources pour obtenir vrais UUIDs",
        });

        console.log(
          `✅ [UUID-RECOVERY] list_available_sources injecté position ${iterationIdx + 1}`,
        );
      }
    }
  }
}
