import { Request, Response } from "express";
import { AIService } from "../../../services/ai/index.js";
import { ConversationMemory } from "../../../services/ai/conversationMemory.js";
import {
  detectPreferredLanguage,
  buildLangInstruction,
} from "../helpers/language.js";
import { isMathLatexIntent, LATEX_STRICT_RULES } from "../helpers/latex.js";
import { WebSearchService } from "../../../services/ai/webSearch.service.js";
import { buildPagesContextChunked } from "../helpers/context.js";
import { sseWriteData } from "../helpers/sse.js";
import { formatAIStreamChunk } from "../helpers/format.js";
import {
  sanitizeUserInput,
  analyzeQuery,
  optimizePrompt,
} from "../helpers/promptOptimizer.js";

// 🚀 NOUVEAUX SERVICES (refactoring architecture)
import { DebugLogger } from "../config/debug.js";
import { ValidationUtils } from "../utils/validation.js";
import { AssistantHandlerService } from "../services/HandlerService.js";
import { prisma } from "../../../lib/prisma.js";
import { indexAndPreparePagesForAI } from "../helpers/pageIndexing.js";
import {
  readPersonalizationFromReq,
  buildPersonaSnippet,
} from "../helpers/personalization.js";
import { mapRagSourcesToRealUUIDs } from "../helpers/sourceMapping.js";

export const assistantAskStream = async (req: Request, res: Response) => {
  try {
    // 🔍 Validation et parsing unifié avec le nouveau service
    const { request, errors } = AssistantHandlerService.parseRequest(req);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const { query, workspaceId, pageIds, useWeb, ragSources } = request;

    // 🔍 DEBUG COMPLET DU FRONTEND
    console.log(
      `\n\n🔍 [ASK-DEBUG-FRONTEND] ========== REQUÊTE DU FRONTEND ==========`,
    );
    console.log(
      `📨 pageIds reçus: ${JSON.stringify(pageIds)} (${pageIds.length})`,
    );
    console.log(
      `📨 ragSources reçus: ${JSON.stringify(ragSources)} (${ragSources.length})`,
    );
    console.log(`📨 sourcesScope reçu: ${(req.body as any)?.sourcesScope}`);
    console.log(`📨 query: "${query.slice(0, 50)}..."`);
    console.log(`🔍 [ASK-DEBUG-FRONTEND] ========== FIN REQUÊTE ==========\n`);

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(`[ASK] useWeb reçu: ${useWeb} (type: ${typeof useWeb})`);
    DebugLogger.rag(
      `[ASK] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}`,
    );

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedQuery = sanitizeUserInput(query);
    const userId = req.user?.id || "anonymous";

    // 🧠 RAG: Gestion intelligente des sources avec validation unifiée
    let contextPageIds: string[] = [];

    // 🔥 PRIORITÉ: Pages mentionnées > Sources RAG externes
    // Les pages workspace mentionnées ont TOUJOURS la priorité
    if (workspaceId && pageIds.length > 0) {
      // 🚀 Validation UUID avec le service unifié
      contextPageIds = ValidationUtils.validatePageIds(pageIds);

      if (contextPageIds.length !== pageIds.length) {
        DebugLogger.rag(
          `IDs invalides filtrés: ${pageIds.length - contextPageIds.length} IDs ignorés`,
        );
      }
      console.log(
        `✅ [ASK-DEBUG] Pages mentionnées trouvées: ${contextPageIds.length} - ${JSON.stringify(contextPageIds)}`,
      );
    }
    // Seulement si PAS de pages mentionnées, utiliser les sources RAG externes
    else if (ragSources && ragSources.length > 0) {
      DebugLogger.rag(
        "[ASK] Pas de pages mentionnées - Mode RAG externe détecté",
      );
      contextPageIds = []; // Pas de pages workspace
      console.log(
        `⚠️ [ASK-DEBUG] Pas de pages mentionnées, utilisation ragSources: ${ragSources.length}`,
      );
    }

    console.log(
      `📊 [ASK-DEBUG] contextPageIds après logique: ${JSON.stringify(contextPageIds)}`,
    );
    console.log(
      `📊 [ASK-DEBUG] ragSources après logique: ${JSON.stringify(ragSources)}`,
    );
    console.log(
      `📊 [ASK-DEBUG] hasSpecificPages: ${contextPageIds.length > 0}`,
    );

    // 🔧 Extraction sourcesScope du body AVANT buildContext
    const sourcesScope = (req.body as any)?.sourcesScope || "custom";
    const hasSpecificPagesCheck = contextPageIds.length > 0;
    const shouldUseFunctionCallingCheck =
      (sourcesScope === "all" && ragSources && ragSources.length > 0) ||
      hasSpecificPagesCheck ||
      (contextPageIds.length === 0 && ragSources && ragSources.length > 0);

    // 🚀 OPTIMISATION: Ne PAS faire le RAG initial si Function Calling sera utilisé
    // Le Function Calling fera le RAG via les tools, ce qui est plus rapide
    const shouldSkipInitialRAG =
      shouldUseFunctionCallingCheck && ragSources && ragSources.length > 0;

    console.log(
      `⚡ [ASK-OPTIMIZATION] shouldUseFunctionCalling: ${shouldUseFunctionCallingCheck}, shouldSkipInitialRAG: ${shouldSkipInitialRAG}`,
    );

    // 🚀 Construction contexte avec le service unifié
    DebugLogger.web(`[ASK] Déclenchement recherche web - useWeb: ${useWeb}`);

    const contextResult = await AssistantHandlerService.buildContextStrategy(
      "ask",
      {
        query: sanitizedQuery,
        workspaceId,
        pageIds: contextPageIds,
        useWeb,
        ragSources: shouldSkipInitialRAG ? [] : ragSources, // 🔥 Skip RAG si Function Calling actif
        userId: req.user?.id || "anonymous",
      },
    );

    DebugLogger.web(
      `[ASK] Contexte construit - pages: ${contextResult.pages.length}, web: ${contextResult.web.length}, rag: ${contextResult.ragContext?.length || 0}`,
    );
    DebugLogger.rag(
      `[ASK] sourcesScope: ${sourcesScope}, pageIds: ${pageIds.length}`,
    );

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    res.flushHeaders();

    // 🔥 TWO-PHASE Function Calling TOUJOURS ACTIF en mode ASK
    // Permet à l'AI d'utiliser les tools (search_rag_chunks, search_web, etc.) pour répondre
    // même si aucune source n'est spécifiquement mentionnée
    const hasSpecificPages = contextPageIds.length > 0;
    const shouldUseFunctionCalling = true; // 🔥 FIX: TOUJOURS actif pour donner accès aux tools

    if (shouldUseFunctionCalling) {
      console.log(
        `🔧 [ASK] Function Calling activé - Pages mentionnées: ${hasSpecificPages}, Mode: ${sourcesScope}`,
      );

      const { CoordinatorService } = await import(
        "../../../services/ai/functionCalling/index.js"
      );
      type OrchestrationRequest = import("../../../services/ai/functionCalling/index.js").OrchestrationRequest;

      // 🔥 Convertir les pages mentionnées en sources RAG pour l'IA
      // IMPORTANT: Si des pages spécifiques sont mentionnées, utiliser SEULEMENT ces pages
      // Pas les sources RAG externes
      let sourcesForAI: any[] = [];

      // Vérifier d'abord s'il y a des pages spécifiquement mentionnées
      // (hasSpecificPages est déjà déclaré à la ligne 82)

      if (
        hasSpecificPages &&
        contextResult.pageObjects &&
        Array.isArray(contextResult.pageObjects) &&
        contextResult.pageObjects.length > 0
      ) {
        console.log(
          `📖 [ASK] Pages spécifiques détectées - utiliser SEULEMENT ces pages, pas les sources RAG`,
        );

        // Pour chaque page, s'assurer qu'une RAGSource existe
        sourcesForAI = await indexAndPreparePagesForAI(
          contextResult.pageObjects,
          userId,
          workspaceId,
        );
      } else if (ragSources && ragSources.length > 0) {
        // Si PAS de pages spécifiques, utiliser les sources RAG externes
        console.log(
          `🔧 [ASK] Pas de pages spécifiques - utiliser les sources RAG externes`,
        );

        // 🔥 FIX: Utiliser la fonction helper pour mapper les IDs vers vrais UUIDs
        sourcesForAI = await mapRagSourcesToRealUUIDs(ragSources);
      }

      console.log(
        `\n🔍 [ASK-DEBUG] sourcesForAI FINAL avant FunctionCalling: ${JSON.stringify(sourcesForAI, null, 2)}\n`,
      );

      let currentThinking = "";
      let currentToolCalls: any[] = [];
      let intermediateThinkingBlocks: any[] = []; // 🔥 NOUVEAU: Stocker intermediate thinking pour metadata

      try {
        const persona = await readPersonalizationFromReq(req);
        const personaSnippet = buildPersonaSnippet(persona, 400);
        // 🔥 PHASE 1: Décision des tools + explication streamée
        console.log(
          `🔧 [ASK-PHASE-1] Démarrage décision tools avec ${sourcesForAI.length} sources...`,
        );

        // 🔥 NOUVEAU: Utilisation du CoordinatorService pour orchestrer Planner → Executor → Scorer
        const orchestrationRequest: OrchestrationRequest = {
          query: sanitizedQuery,
          workspaceId,
          userId: req.user!.id,
          availableSources: sourcesForAI,
          useWeb,
          isSearch: false, // 🔥 Flag pour Ask - réponse plus courte (1-3 tools max)
          systemPrompt: `System: Réponds de manière claire, précise et structurée, en tant qu'assistant IA intelligent.

${personaSnippet}

'''${LATEX_STRICT_RULES}'''`,

          // Callbacks pour streaming temps réel
          onThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            currentThinking += thinkingChunk;
            res.write(
              `event: thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },

          onToolCall: (toolName, args) => {
            const timestamp = new Date().toISOString();
            res.write(
              `event: tool_call\ndata: ${JSON.stringify({ tool: toolName, args, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },

          onToolResult: (toolName, toolResult) => {
            const timestamp = new Date().toISOString();
            const truncated =
              toolResult.length > 200
                ? toolResult.slice(0, 200) + "..."
                : toolResult;
            res.write(
              `event: tool_result\ndata: ${JSON.stringify({ tool: toolName, result: truncated, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },

          // 🔥 Thinking intermédiaire entre les outils (comme search/create)
          onIntermediateThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            res.write(
              `event: intermediate_thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },
        };

        // 🚀 ARCHITECTURE OPTIMISÉE: Utilise orchestrateOptimized() pour gains de performance
        // - 75-83% moins d'appels API
        // - >80% plus rapide (exécution parallèle)
        // - 87-96% moins cher (avec prompt caching)
        const toolDecision = await CoordinatorService.orchestrateOptimized(
          orchestrationRequest,
        );

        currentToolCalls = toolDecision.toolCalls;
        intermediateThinkingBlocks =
          toolDecision.intermediateThinkingBlocks || []; // 🔥 NOUVEAU: Capturer les intermediate thinking blocks
        console.log(
          `✅ [ASK-PHASE-1] Terminé: ${toolDecision.toolCalls.length} tools exécutés, success: ${toolDecision.success}`,
        );

        // 🔥 PHASE 2: Génération réponse finale avec résultats des tools
        if (toolDecision.success && toolDecision.toolCalls.length > 0) {
          // Import FunctionCallingService pour buildContextFromToolResults et generateWithToolResults
          const { FunctionCallingService } = await import(
            "../../../services/ai/functionCalling/index.js"
          );
          console.log(`🔧 [ASK-PHASE-2] Génération réponse finale...`);

          const toolResults =
            FunctionCallingService.buildContextFromToolResults(
              toolDecision.toolCalls,
            );

          // 📚 Extraire les sources Wikipedia pour l'attribution de licence
          const {
            extractWikipediaSourcesFromToolCalls,
            extractWikipediaSourcesFromRagSources,
          } = await import(
            "../../../services/ai/functionCalling/utils/wikipediaExtractor.js"
          );
          let wikipediaSources = await extractWikipediaSourcesFromToolCalls(
            toolDecision.toolCalls,
          );

          // Si aucune source Wikipedia trouvée via tools, extraire depuis ragSources
          if (
            wikipediaSources.length === 0 &&
            ragSources &&
            ragSources.length > 0
          ) {
            console.log(
              `📚 [ASK-PHASE-2] Aucune source Wikipedia via tools, extraction depuis ragSources...`,
            );
            wikipediaSources =
              await extractWikipediaSourcesFromRagSources(ragSources);
          }

          await FunctionCallingService.generateWithToolResults({
            query: sanitizedQuery,
            toolResults,
            systemPrompt: `System: Réponds de manière claire, précise et structurée, en tant qu'assistant IA intelligent.

${personaSnippet}

'''${LATEX_STRICT_RULES}'''`,
            wikipediaSources,
            onStream: (chunk) => {
              sseWriteData(res, chunk);
            },
          });

          console.log(`✅ [ASK-PHASE-2] Réponse finale streamée`);
        } else {
          // Pas de tools utilisés → réponse directe (fallback)
          console.log(
            `🔧 [ASK-FALLBACK] Pas de tools utilisés, génération directe...`,
          );

          // 📚 Même en fallback, extraire les sources Wikipedia depuis ragSources pour les licences
          const {
            extractWikipediaSourcesFromRagSources,
            buildWikipediaLicenseFooter,
          } = await import(
            "../../../services/ai/functionCalling/utils/wikipediaExtractor.js"
          );
          let wikipediaSources: any[] = [];
          if (ragSources && ragSources.length > 0) {
            wikipediaSources =
              await extractWikipediaSourcesFromRagSources(ragSources);
          }

          let fullAnswer = "";
          const persona = await readPersonalizationFromReq(req);
          const personaSnippet = buildPersonaSnippet(persona, 400);
          await AIService.generateContent({
            prompt: sanitizedQuery,
            context: `System: Réponds de manière claire, précise et structurée, en tant qu'assistant IA intelligent.

${personaSnippet}

'''${LATEX_STRICT_RULES}'''`,
            temperature: 0.2,
            maxTokens: 4000,
            onStream: (chunk: string) => {
              fullAnswer += chunk;
              sseWriteData(res, chunk);
            },
          });

          // Ajouter le footer de licence Wikipedia si des sources sont présentes
          if (wikipediaSources.length > 0) {
            const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);
            if (licenseFooter) {
              console.log(
                `📚 [ASK-FALLBACK] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`,
              );
              sseWriteData(res, licenseFooter);
              fullAnswer += licenseFooter;
            }
          }
        }

        // Envoyer les métadonnées pour sauvegarde frontend
        res.write(`event: metadata\n`);
        res.write(
          `data: ${JSON.stringify({
            toolCalls: currentToolCalls,
            thinking: currentThinking,
            usedFallback: !toolDecision.success || toolDecision.toolCalls.length === 0,
            intermediateThinkingBlocks: intermediateThinkingBlocks, // 🔥 NOUVEAU: Inclure intermediate thinking blocks comme search/create
          })}\n\n`,
        );

        try {
          ConversationMemory.addMessage(
            req.user?.id || "anonymous",
            "user",
            sanitizedQuery,
          );
          ConversationMemory.addMessage(
            req.user?.id || "anonymous",
            "assistant",
            "",
          );
        } catch {}

        res.write("event: done\n\n");
        res.end();
        return;
      } catch (error) {
        console.error("❌ [FUNCTION-CALLING] Erreur:", error);
        // Fallback sur système classique ci-dessous
      }
    }

    // 🎯 Système classique (si pas de sources RAG ou erreur Function Calling)
    const history = ConversationMemory.recentAsText(
      req.user?.id || "anonymous",
      { maxChars: 1200, maxMessages: 8 },
    );

    // 🎯 OPTIMISATION COMPLÈTE: Prompt avec troncature intelligente garantie
    // 🔥 INCLURE le contexte RAG (fichiers, Wikipedia) si disponible
    const contextWithWeb = [
      contextResult.ragContext,
      contextResult.pages,
      contextResult.web,
    ]
      .filter(Boolean)
      .join("\n\n");
    const optimizedPrompt = optimizePrompt(
      "ask",
      sanitizedQuery,
      contextWithWeb,
      history,
      req,
    );
    const persona = await readPersonalizationFromReq(req);
    const personaSnippet = buildPersonaSnippet(persona, 600);

    let fullAnswer = "";
    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: `${personaSnippet ? personaSnippet + "\n\n" : ""}${optimizedPrompt.systemMessage}`,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = formatAIStreamChunk(chunk);
        fullAnswer += normalized;
        sseWriteData(res, normalized);
      },
    });
    try {
      ConversationMemory.addMessage(
        req.user?.id || "anonymous",
        "user",
        sanitizedQuery,
      );
      ConversationMemory.addMessage(
        req.user?.id || "anonymous",
        "assistant",
        fullAnswer.trim(),
      );
    } catch {}
    res.write("event: done\n\n");
    res.end();
  } catch (e) {
    console.error("assistantAskStream error", e);
    try {
      res.write(`event: error\ndata: ${(e as any)?.message || "Erreur"}\n\n`);
    } catch {}
    res.end();
  }
};
