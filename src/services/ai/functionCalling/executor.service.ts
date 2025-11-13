/**
 * Executor Service - Intermediate Thinking and Tool Execution
 *
 * Ce service est responsable de l'exécution d'un step du plan :
 * 1. Génération du prompt Intermediate Thinking basé sur le contexte
 * 2. Appel GPT-4o pour générer les arguments du tool
 * 3. Parsing du JSON avec les arguments
 * 4. Exécution du tool via ToolExecutor
 * 5. Extraction des sources si applicable (list_available_sources, etc.)
 */

import { AIService } from "../base.js";
import { ToolExecutor, type ToolContext } from "../tools/executors.js";
import { parseJSONFromStream } from "./utils/jsonParser.js";
import {
  isIntermediateThinkingOutput,
  type IntermediateThinkingOutput,
} from "../../../types/ragThinking.js";
import type { StrategyAdjustment } from "./scoring.service.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

/**
 * Représente un step à exécuter dans le plan
 */
export interface ExecutionStep {
  toolName: string;
  description: string;
  params?: any;
}

/**
 * Contexte d'exécution pour un step
 */
export interface ExecutionContext {
  userId: string;
  workspaceId: string;
  query: string;
  isSearch: boolean;
  useWeb: boolean;
  executedTools: Array<{
    name: string;
    arguments: any;
    result: string;
    score?: any;
  }>;
  extractedSources: Array<{
    id: string;
    title: string;
    sourceType: string;
  }>;
  currentIteration: number;
  maxIterations: number;
  remainingTools: string[];
  initialMessages: ChatCompletionMessageParam[];
  strategyAdjustment?: StrategyAdjustment;
}

/**
 * Résultat de l'exécution d'un step
 */
export interface ExecutionResult {
  toolName: string;
  arguments: any;
  result: string;
  thinking: string;
  extractedSources: Array<{
    id: string;
    title: string;
    sourceType: string;
  }>;
  success: boolean;
  shouldContinue: boolean;
  modifiedToolSequence?: Array<{
    step: number;
    toolName: string;
    description: string;
  }>;
  intermediateParsed?: IntermediateThinkingOutput;
}

/**
 * Callbacks pour le streaming des résultats
 */
export interface ExecutionCallbacks {
  onIntermediateThinking?: (chunk: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: string) => void;
}

/**
 * Service pour l'exécution des tools avec Intermediate Thinking
 */
export class ExecutorService {
  /**
   * Exécute un step du plan avec Intermediate Thinking
   *
   * Cette méthode :
   * 1. Génère le prompt Intermediate Thinking avec le contexte
   * 2. Appelle GPT-4o pour obtenir les arguments du tool
   * 3. Parse le JSON de réponse
   * 4. Exécute le tool via ToolExecutor
   * 5. Extrait les sources si applicable
   *
   * @param step - Le step à exécuter
   * @param context - Le contexte d'exécution
   * @param callbacks - Les callbacks pour le streaming
   * @returns Le résultat de l'exécution
   */
  static async executeStep(
    step: ExecutionStep,
    context: ExecutionContext,
    callbacks: ExecutionCallbacks = {},
  ): Promise<ExecutionResult> {
    const { onIntermediateThinking, onToolCall, onToolResult } = callbacks;
    const openai = AIService.getOpenAI();

    console.log(
      `🧠 [EXECUTOR] Génération Intermediate Thinking pour ${step.toolName}...`,
    );

    try {
      // Construire l'historique des tools exécutés
      const previousWebQueries = context.executedTools
        .filter((tc) => tc.name === "search_web")
        .map((tc) => tc.arguments?.query || "")
        .filter((q) => q.length > 0);

      const executedToolsStr = context.executedTools
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

      const remainingToolsStr = context.remainingTools
        .map((t) => `- ${t}`)
        .join("\n");

      // Construire le prompt Intermediate Thinking
      const intermediateThinkingPrompt = this.buildIntermediateThinkingPrompt({
        query: context.query,
        isSearch: context.isSearch,
        useWeb: context.useWeb,
        executedTools: executedToolsStr,
        previousWebQueries,
        remainingTools: remainingToolsStr,
        maxIterations: context.maxIterations,
        strategyAdjustment: context.strategyAdjustment,
      });

      // Appeler GPT-5 pour générer les arguments
      let intermediateThinkingContent = "";
      const intermediateStream = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [
          ...context.initialMessages,
          {
            role: "user",
            content: intermediateThinkingPrompt,
          },
        ],
        temperature: 0.1, // Very low temperature for strict plan following in search mode
        max_completion_tokens: 800, // GPT-5 uses max_completion_tokens instead of max_tokens
        stream: true,
        response_format: { type: "json_object" } as any, // JSON MODE STRICT
      });

      // Streamer le thinking intermédiaire
      for await (const chunk of intermediateStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          intermediateThinkingContent += delta.content;
          if (onIntermediateThinking) {
            onIntermediateThinking(delta.content);
          }
        }
      }

      console.log(
        `✅ [EXECUTOR] Intermediate thinking généré: ${intermediateThinkingContent.length} chars`,
      );

      // Parser intermediate thinking JSON
      const intermediateParsed = parseJSONFromStream(
        intermediateThinkingContent,
      );

      if (!isIntermediateThinkingOutput(intermediateParsed)) {
        console.warn(`⚠️ [EXECUTOR] Invalid intermediate thinking format`);
        // Fallback: utiliser la description comme query
        const fallbackArgs = { query: step.description };
        const toolContext: ToolContext = {
          userId: context.userId,
          workspaceId: context.workspaceId,
        };

        if (onToolCall) {
          onToolCall(step.toolName, fallbackArgs);
        }

        const result = await ToolExecutor.executeToolCall(
          step.toolName,
          fallbackArgs,
          toolContext,
        );

        if (onToolResult) {
          onToolResult(step.toolName, result);
        }

        return {
          toolName: step.toolName,
          arguments: fallbackArgs,
          result,
          thinking: "Fallback execution (invalid intermediate thinking)",
          extractedSources: [],
          success: !result.startsWith("❌"),
          shouldContinue: true,
        };
      }

      // Extraire les arguments du tool
      let toolArgs = intermediateParsed.toolArguments || {};

      // Vérifier si l'IA veut arrêter
      if (intermediateParsed.shouldContinue === false) {
        console.log(
          `⏹️ [EXECUTOR] IA a décidé d'arrêter la boucle (shouldContinue: false)`,
        );
        return {
          toolName: step.toolName,
          arguments: toolArgs,
          result: "",
          thinking: intermediateParsed.thinking,
          extractedSources: [],
          success: true,
          shouldContinue: false,
          modifiedToolSequence: intermediateParsed.modifiedToolSequence,
          intermediateParsed,
        };
      }

      // Vérifier si l'IA veut modifier le plan
      if (
        intermediateParsed.modifiedToolSequence &&
        intermediateParsed.modifiedToolSequence.length > 0
      ) {
        console.log(
          `🔄 [EXECUTOR] IA veut modifier le plan: ${intermediateParsed.modifiedToolSequence.map((t: { toolName: string }) => t.toolName).join(" → ")}`,
        );
      }

      // 🔧 Corrections spécifiques par tool (select_relevant_sources, search_web)
      toolArgs = this.fixToolArguments(
        step.toolName,
        toolArgs,
        context.query,
        context.extractedSources,
      );

      console.log(`✅ [EXECUTOR] Arguments extraits:`, toolArgs);

      // Exécuter le tool
      const toolContext: ToolContext = {
        userId: context.userId,
        workspaceId: context.workspaceId,
      };

      if (onToolCall) {
        onToolCall(step.toolName, toolArgs);
      }

      const result = await ToolExecutor.executeToolCall(
        step.toolName,
        toolArgs,
        toolContext,
      );

      console.log(
        `✅ [EXECUTOR] Tool ${step.toolName} exécuté: ${result.length} chars`,
      );

      if (onToolResult) {
        onToolResult(step.toolName, result);
      }

      // Extraire les sources si applicable
      const extractedSources = this.extractSourcesFromResult(
        step.toolName,
        result,
      );

      console.log(
        `🔄 [EXECUTOR] ${extractedSources.length} sources extraites de ${step.toolName}`,
      );

      return {
        toolName: step.toolName,
        arguments: toolArgs,
        result,
        thinking: intermediateParsed.thinking,
        extractedSources,
        success: !result.startsWith("❌"),
        shouldContinue: intermediateParsed.shouldContinue ?? true,
        modifiedToolSequence: intermediateParsed.modifiedToolSequence,
        intermediateParsed,
      };
    } catch (error) {
      console.error(`❌ [EXECUTOR] Erreur exécution ${step.toolName}:`, error);

      // En cas d'erreur, essayer quand même d'exécuter le tool avec des arguments par défaut
      const fallbackArgs = { query: context.query };
      const toolContext: ToolContext = {
        userId: context.userId,
        workspaceId: context.workspaceId,
      };

      try {
        const result = await ToolExecutor.executeToolCall(
          step.toolName,
          fallbackArgs,
          toolContext,
        );

        return {
          toolName: step.toolName,
          arguments: fallbackArgs,
          result,
          thinking: `Error in intermediate thinking: ${error}`,
          extractedSources: [],
          success: !result.startsWith("❌"),
          shouldContinue: true,
        };
      } catch (toolError) {
        return {
          toolName: step.toolName,
          arguments: fallbackArgs,
          result: `❌ Erreur: ${toolError}`,
          thinking: `Error: ${error}`,
          extractedSources: [],
          success: false,
          shouldContinue: false,
        };
      }
    }
  }

  /**
   * Construit le prompt pour l'Intermediate Thinking
   */
  private static buildIntermediateThinkingPrompt(params: {
    query: string;
    isSearch: boolean;
    useWeb: boolean;
    executedTools: string;
    previousWebQueries: string[];
    remainingTools: string;
    maxIterations: number;
    strategyAdjustment?: StrategyAdjustment;
  }): string {
    const {
      query,
      isSearch,
      useWeb,
      executedTools,
      previousWebQueries,
      remainingTools,
      maxIterations,
      strategyAdjustment,
    } = params;

    // Construire la recommandation stratégique
    const strategyRecommendation = strategyAdjustment
      ? `
CURRENT STRATEGY EVALUATION (based on scores):
${strategyAdjustment.reasoning}

ADAPTIVE RECOMMENDATIONS (informational only - continue plan execution):
- Explore more sources? ${strategyAdjustment.shouldExploreMore ? "Yes" : "No"}
- Use search_web? ${strategyAdjustment.shouldUseWeb ? "Yes (priority: " + strategyAdjustment.priority + ")" : "No"}
${strategyAdjustment.suggestedTools.length > 0 ? "- Suggested tools: " + strategyAdjustment.suggestedTools.join(", ") : ""}

IMPORTANT: These are quality indicators ONLY. You MUST continue executing the planned tool sequence unless you have gathered ALL required information comprehensively. In search mode, execute the FULL plan to ensure thorough exploration.`
      : "";

    const webInstruction = useWeb
      ? `\nWEB SEARCH AVAILABLE: ${
          strategyAdjustment?.shouldUseWeb
            ? `Strategy strongly recommends using search_web (priority: ${strategyAdjustment.priority})`
            : "Web search is available if needed to enrich"
        }`
      : "";

    const previousWebQueriesSection =
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
        : "";

    return `You received results. Analyze them and determine the next step.

${strategyRecommendation}

Before any decision, start with a concise checklist (3-7 conceptual points) describing the steps to consider based on received data.

ORIGINAL QUESTION: "${query}"

TOOLS ALREADY EXECUTED:
${executedTools || "None"}

${previousWebQueriesSection}

REMAINING TOOLS IN PLAN:
${remainingTools || "None"}

IMPORTANT - READ ACTUAL RESULTS:
Previous results are recorded in context above (result of Tool X).
- If a tool returns "No sources" → It's REAL, there are no sources of that type
- If a tool returns a list → COUNT sources and select the BEST ones
- NEVER INVENT sources! Use ONLY those listed in previous results
- If NO tool found sources → You MUST call the NEXT tool in the plan

EXECUTION MODE: ${isSearch ? "SEARCH (thorough exploration required)" : "ASK (focused response)"}
${
  isSearch
    ? `
CRITICAL - SEARCH MODE REQUIREMENTS:
- You MUST execute the FULL planned sequence (${maxIterations} tools)
- NEVER stop early just because initial results seem "sufficient"
- Search mode requires COMPREHENSIVE exploration across multiple sources
- Quality indicators are informational only - continue the full plan
- Only stop if you have exhausted ALL planned tools or reached maximum depth
`
    : ""
}

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

The "toolArguments" field must match the structure expected by the tool (see examples above). All fields except "modifiedToolSequence" are REQUIRED in each response unless shouldContinue is false: in that case, "nextToolName" and "toolArguments" can be omitted or null. Output MUST contain NO text outside the JSON object.${webInstruction}`;
  }

  /**
   * Corrige les arguments d'un tool selon des règles spécifiques
   */
  private static fixToolArguments(
    toolName: string,
    toolArgs: any,
    originalQuery: string,
    extractedSources: Array<{ id: string; title: string; sourceType: string }>,
  ): any {
    // 🔥 FIX: select_relevant_sources - Ajouter les arguments manquants
    if (toolName === "select_relevant_sources") {
      // Add question if missing
      if (!toolArgs.question) {
        toolArgs.question = originalQuery;
        console.log(
          `🔧 [EXECUTOR] Added missing 'question' to select_relevant_sources`,
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
            `🔧 [EXECUTOR] Added extracted sources (${extractedSources.length}) to select_relevant_sources`,
          );
        } else {
          console.warn(
            `⚠️ [EXECUTOR] No extracted sources available for select_relevant_sources`,
          );
        }
      }
    }

    // 🔥 FIX: search_web - Valider et nettoyer les arguments
    if (toolName === "search_web") {
      // Validation: search_web needs 'query' (string), not 'question' or 'availableSources' or 'maxResults'
      if (!toolArgs.query || typeof toolArgs.query !== "string") {
        // If IA provided wrong arguments (like 'question' or 'availableSources'), fix it
        if (toolArgs.question && typeof toolArgs.question === "string") {
          toolArgs = { query: toolArgs.question };
          console.log(
            `🔧 [EXECUTOR] Fixed search_web arguments: converted 'question' to 'query'`,
          );
        } else {
          // Fallback: use original query
          toolArgs = { query: originalQuery };
          console.log(
            `🔧 [EXECUTOR] Fixed search_web arguments: using original query`,
          );
        }
      } else {
        // Clean up any extra fields that don't belong to search_web (including maxResults)
        toolArgs = { query: toolArgs.query };
        console.log(`🔧 [EXECUTOR] Cleaned search_web arguments`);
      }
    }

    return toolArgs;
  }

  /**
   * Extrait les sources d'un résultat de tool
   *
   * Fonctionne pour :
   * - list_available_sources
   * - list_global_wikipedia_sources
   *
   * @param toolName - Le nom du tool
   * @param result - Le résultat du tool
   * @returns Liste des sources extraites
   */
  private static extractSourcesFromResult(
    toolName: string,
    result: string,
  ): Array<{ id: string; title: string; sourceType: string }> {
    const extractedSources: Array<{
      id: string;
      title: string;
      sourceType: string;
    }> = [];

    // Vérifier si c'est un tool qui liste des sources
    if (
      toolName !== "list_available_sources" &&
      toolName !== "list_global_wikipedia_sources"
    ) {
      return extractedSources;
    }

    // Vérifier si le résultat est valide
    if (
      !result ||
      result.startsWith("❌") ||
      result.startsWith("Aucune") ||
      result.startsWith("No sources")
    ) {
      return extractedSources;
    }

    try {
      // Parse source listings from the result (format: "ID: XXX")
      const sourceMatches = result.match(/ID: ([a-f0-9\-]+)/g);
      if (sourceMatches) {
        sourceMatches.forEach((match: string) => {
          const id = match.replace("ID: ", "");
          // Parse the title from the line above
          const lines = result.split("\n");
          const matchIdx = lines.findIndex((line) => line.includes(match));

          if (matchIdx > 0) {
            const titleLine = lines[matchIdx - 3] || "";
            const titleMatch = titleLine.match(/\d+\.\s*\[.+?\]\s*(.+)/);
            const title = titleMatch ? titleMatch[1] : "Unknown";

            const typeLineIdx = lines.findIndex(
              (line, idx) => idx > matchIdx - 3 && line.startsWith("   Type:"),
            );
            const typeMatch =
              typeLineIdx >= 0
                ? lines[typeLineIdx].match(/Type:\s*(.+)/)
                : null;
            const sourceType = typeMatch ? typeMatch[1].trim() : "WIKIPEDIA";

            // Éviter les doublons
            if (!extractedSources.find((s) => s.id === id)) {
              extractedSources.push({ id, title, sourceType });
            }
          }
        });

        console.log(
          `🔄 [EXECUTOR] Extracted ${extractedSources.length} sources from ${toolName}`,
        );
      }
    } catch (parseError) {
      console.warn(
        `⚠️ [EXECUTOR] Failed to extract sources from ${toolName} result:`,
        parseError,
      );
    }

    return extractedSources;
  }
}
