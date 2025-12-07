/**
 * 🔍 SEARCH STREAM HANDLER - REFACTORISÉ
 * Handler unifié pour la recherche avec RAG + Web + Workspace
 */

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
import { prismaEmbeddings } from "../../../lib/prismaEmbeddings.js";
import { indexAndPreparePagesForAI } from "../helpers/pageIndexing.js";
import {
  readPersonalizationFromReq,
  buildPersonaSnippet,
} from "../helpers/personalization.js";
import { mapRagSourcesToRealUUIDs } from "../helpers/sourceMapping.js";

export const assistantSearchStream = async (req: Request, res: Response) => {
  try {
    // 🔍 Validation et parsing unifié avec le nouveau service
    const { request, errors } = AssistantHandlerService.parseRequest(req);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const { query, workspaceId, pageIds, useWeb, ragSources } = request;

    // 🔍 DEBUG COMPLET DU FRONTEND
    console.log(
      `\n\n🔍 [SEARCH-DEBUG-FRONTEND] ========== REQUÊTE DU FRONTEND ==========`,
    );
    console.log(
      `📨 pageIds reçus: ${JSON.stringify(pageIds)} (${pageIds.length})`,
    );
    console.log(
      `📨 ragSources reçus: ${JSON.stringify(ragSources)} (${ragSources.length})`,
    );
    console.log(`📨 sourcesScope reçu: ${(req.body as any)?.sourcesScope}`);
    console.log(`📨 query: "${query.slice(0, 50)}..."`);
    console.log(
      `🔍 [SEARCH-DEBUG-FRONTEND] ========== FIN REQUÊTE ==========\n`,
    );

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(`[SEARCH] useWeb reçu: ${useWeb} (type: ${typeof useWeb})`);
    DebugLogger.rag(
      `[SEARCH] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}`,
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
    }
    // Seulement si PAS de pages mentionnées, utiliser les sources RAG externes
    else if (ragSources && ragSources.length > 0) {
      DebugLogger.rag(
        "[SEARCH] Pas de pages mentionnées - Mode RAG externe détecté",
      );
      contextPageIds = []; // Pas de pages workspace
    }

    // 🔧 Extraction sourcesScope du body AVANT buildContext
    const sourcesScope = (req.body as any)?.sourcesScope || "custom";

    // 🔥 FIX: En mode search, TOUJOURS activer Function Calling
    // Le firstThinking décidera lui-même quels tools utiliser
    const shouldUseFunctionCallingCheck = true;

    // 🚀 OPTIMISATION: Ne PAS faire le RAG initial si Function Calling sera utilisé
    // Le Function Calling fera le RAG via les tools, ce qui est plus rapide
    const shouldSkipInitialRAG = true; // Toujours skip en mode search

    console.log(
      `⚡ [SEARCH-OPTIMIZATION] shouldUseFunctionCalling: ${shouldUseFunctionCallingCheck}, shouldSkipInitialRAG: ${shouldSkipInitialRAG}`,
    );

    // 🚀 Construction contexte avec le service unifié
    DebugLogger.web(`[SEARCH] Déclenchement recherche web - useWeb: ${useWeb}`);

    const contextResult = await AssistantHandlerService.buildContextStrategy(
      "search",
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
      `[SEARCH] Contexte construit - pages: ${contextResult.pages.length}, web: ${contextResult.web.length}, rag: ${contextResult.ragContext?.length || 0}`,
    );
    DebugLogger.rag(
      `[SEARCH] sourcesScope: ${sourcesScope}, pageIds: ${pageIds.length}`,
    );

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    res.flushHeaders();

    // 🔥 TWO-PHASE Function Calling: TOUJOURS activer en mode search
    // Le firstThinking décidera lui-même quels tools utiliser selon la question
    const shouldUseFunctionCalling = true;

    if (shouldUseFunctionCalling) {
      console.log(
        `🔧 [SEARCH] Function Calling activé - sourcesScope: ${sourcesScope}, ragSources: ${ragSources?.length || 0}`,
      );

      const { CoordinatorService } =
        await import("../../../services/ai/functionCalling/index.js");
      type OrchestrationRequest =
        import("../../../services/ai/functionCalling/index.js").OrchestrationRequest;

      // 🔥 Variable pour savoir si des pages spécifiques ont été mentionnées
      const hasSpecificPages = contextPageIds.length > 0;

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
          `📖 [SEARCH] Pages spécifiques détectées - utiliser SEULEMENT ces pages, pas les sources RAG`,
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
          `🔧 [SEARCH] Pas de pages spécifiques - utiliser les sources RAG externes`,
        );

        // 🔥 FIX: Utiliser la fonction helper pour mapper les IDs vers vrais UUIDs
        sourcesForAI = await mapRagSourcesToRealUUIDs(ragSources);
      } else if (sourcesScope === "all") {
        // 🔥 MODE ALL: Récupérer TOUTES les sources RAG disponibles dans le workspace
        console.log(
          `🌐 [SEARCH] Mode ALL détecté - récupération de toutes les sources du workspace`,
        );

        const { default: prisma } = await import("../../../lib/prisma.js");

        // Récupérer toutes les sources du workspace de l'utilisateur
        const allWorkspaceSources = await prismaEmbeddings.rAGSource.findMany({
          where: {
            workspaceId,
            userId,
            status: "COMPLETED", // Seulement les sources complètes et utilisables
          },
          select: {
            id: true,
            title: true,
            sourceType: true,
            totalChunks: true,
            lastUsedAt: true,
            status: true,
            isGlobal: true,
          },
          orderBy: { lastUsedAt: "desc" },
        });

        console.log(
          `✅ [SEARCH] ${allWorkspaceSources.length} sources disponibles en mode ALL`,
        );

        // Formater pour l'IA
        sourcesForAI = allWorkspaceSources.map((s) => ({
          id: s.id,
          title: s.title,
          sourceType: s.sourceType,
        }));
      }

      let currentThinking = "";
      let currentToolCalls: any[] = [];
      let intermediateThinkingBlocks: any[] = []; // 🔥 Stocker intermediate thinking pour metadata

      try {
        // 🆕 GESTION DE L'HISTORIQUE DES CONVERSATIONS
        const {
          ConversationHistoryService,
          TokenCounterService,
          HistoryCompressionService,
        } =
          await import("../../../services/ai/functionCalling/history/index.js");

        const userId = req.user!.id;

        // Ajouter le message utilisateur à l'historique
        await ConversationHistoryService.addUserMessage(
          userId,
          workspaceId,
          sanitizedQuery,
          {
            web: useWeb,
            all: sourcesScope === "all",
            sources: sourcesForAI,
          },
        );

        // Récupérer l'historique
        let history = await ConversationHistoryService.getHistory(
          userId,
          workspaceId,
        );
        let conversationHistory: string | null = null;

        if (history && history.messages.length > 1) {
          // Vérifier si compression nécessaire
          const tokenCount = TokenCounterService.countHistoryTokens(history);
          await ConversationHistoryService.updateTotalTokens(
            userId,
            workspaceId,
            tokenCount.totalTokens,
          );

          if (tokenCount.needsCompression) {
            console.log(
              `🗜️ [SEARCH-HISTORY] Compression nécessaire (${tokenCount.totalTokens.toLocaleString()} tokens > ${TokenCounterService.COMPRESSION_THRESHOLD.toLocaleString()})`,
            );

            // Envoyer événement de début de compression
            res.write(
              `event: compression_start\ndata: ${JSON.stringify({
                conversationId: workspaceId,
                totalTokens: tokenCount.totalTokens,
                threshold: 4000,
                status: "compressing",
              })}\n\n`,
            );

            // 🔥 FORCER L'ENVOI IMMÉDIAT au client (flush le buffer)
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }

            console.log(
              "🔄 [COMPRESSION] Démarrage compression conversation:",
              workspaceId,
            );

            try {
              // Compresser avec GPT-4o-mini
              const compressionResult =
                await HistoryCompressionService.compressHistory(history);

              console.log(
                `✅ [SEARCH-HISTORY] Compression réussie: ${compressionResult.originalTokens.toLocaleString()} → ${compressionResult.compressedTokens.toLocaleString()} tokens (${(compressionResult.compressionRatio * 100).toFixed(2)}%)`,
              );

              // Remplacer l'historique par la version compressée
              await ConversationHistoryService.replaceWithCompressedHistory(
                userId,
                workspaceId,
                compressionResult.compressedContent,
              );

              // Envoyer événement de fin de compression
              res.write(
                `event: compression_complete\ndata: ${JSON.stringify({
                  conversationId: workspaceId,
                  newTokens: compressionResult.compressedTokens,
                  status: "completed",
                })}\n\n`,
              );

              // 🔥 FORCER L'ENVOI IMMÉDIAT au client (flush le buffer)
              if (typeof (res as any).flush === "function") {
                (res as any).flush();
              }

              console.log(
                "✅ [COMPRESSION] Compression terminée:",
                workspaceId,
              );

              conversationHistory = compressionResult.compressedContent;
            } catch (compressionError) {
              console.error(
                `❌ [SEARCH-HISTORY] Erreur compression:`,
                compressionError,
              );
              // Fallback : utiliser l'historique non compressé
              conversationHistory =
                await ConversationHistoryService.formatHistoryForBrain(
                  userId,
                  workspaceId,
                );
            }
          } else {
            // Pas besoin de compression
            conversationHistory =
              await ConversationHistoryService.formatHistoryForBrain(
                userId,
                workspaceId,
              );
            console.log(
              `📝 [SEARCH-HISTORY] Historique chargé (${tokenCount.totalTokens.toLocaleString()} tokens, pas de compression nécessaire)`,
            );
          }
        } else {
          console.log(
            `📝 [SEARCH-HISTORY] Pas d'historique précédent ou premier message`,
          );
        }

        const persona = await readPersonalizationFromReq(req);
        const personaSnippet = buildPersonaSnippet(persona, 400);
        // 🔥 PHASE 1: Décision des tools + explication streamée
        console.log(
          `🔧 [SEARCH-PHASE-1] Démarrage décision tools avec ${sourcesForAI.length} sources...`,
        );

        // 🔥 NOUVEAU: Utilisation du CoordinatorService pour orchestrer Planner → Executor → Scorer
        const orchestrationRequest: OrchestrationRequest = {
          query: sanitizedQuery,
          workspaceId,
          userId: req.user!.id,
          availableSources: sourcesForAI,
          useWeb,
          isSearch: true, // 🔥 Flag pour Search - utilise plus de tools
          systemPrompt: `System: Réponds de manière claire, précise et structurée en tant qu'assistant IA intelligent.

${personaSnippet}

'''${LATEX_STRICT_RULES}'''`,
          conversationHistory, // 🆕 Passer l'historique au brain (PlannerService)

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

          // 🔥 Thinking intermédiaire entre les requêtes
          onIntermediateThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            res.write(
              `event: intermediate_thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },

          // 🆕 Scoring phase callback
          onScoring: (toolName, progress) => {
            const timestamp = new Date().toISOString();
            res.write(
              `event: scoring\ndata: ${JSON.stringify({ tool: toolName, progress, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },
          
          // 🆕 Réponse partielle (2 vagues style Perplexity)
          onPartialResponse: (text, isPartial) => {
            const timestamp = new Date().toISOString();
            console.log(`📤 [SEARCH-PARTIAL] Envoi réponse partielle (${text.length} chars)...`);
            res.write(
              `event: partial_response\ndata: ${JSON.stringify({ text, isPartial, timestamp })}\n\n`,
            );
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          },
          
          model: "grok-4-1-fast-reasoning", // 🧠 Modèle spécifique demandé
        };

        // 🚀 ARCHITECTURE OPTIMISÉE: Utilise orchestrateOptimized() pour gains de performance
        // - 75-83% moins d'appels API
        // - >80% plus rapide (exécution parallèle)
        // - 87-96% moins cher (avec prompt caching)
        const toolDecision =
          await CoordinatorService.orchestrateOptimized(orchestrationRequest);

        currentToolCalls = toolDecision.toolCalls;
        intermediateThinkingBlocks =
          toolDecision.intermediateThinkingBlocks || []; // 🔥 Capturer les intermediate thinking blocks
        console.log(
          `✅ [SEARCH-PHASE-1] Terminé: ${toolDecision.toolCalls.length} tools exécutés, success: ${toolDecision.success}`,
        );

        // 🔥 WEB GRATUIT: Plus de remboursement nécessaire car le web ne coûte plus de crédits
        // (Code conservé en commentaire pour référence historique)
        // const usedSearchWeb = toolDecision.toolCalls.some(tc => tc.name === 'search_web');
        // if (usedSearchWeb && !useWeb) {
        //   console.log(`💰 [CREDITS-REFUND] L'IA a utilisé search_web sans activation utilisateur - Remboursement de 0.25 crédits`);
        //   try {
        //     const { AICreditsService } = await import('../../../services/credits/aiCreditsService.js');
        //     const refundResult = await AICreditsService.refundCredits(userId, 0.25, 'search_web_ai_decision');
        //     if (refundResult.success) {
        //       console.log(`✅ [CREDITS-REFUND] Remboursement réussi - Nouveau solde: ${refundResult.newBalance}`);
        //     }
        //   } catch (refundError) {
        //     console.error(`❌ [CREDITS-REFUND] Erreur lors du remboursement:`, refundError);
        //   }
        // }

        // 🔥 PHASE 2: Génération réponse finale avec résultats des tools
        let fullFinalResponse = ""; // 🆕 Capturer la réponse finale pour l'historique

        if (toolDecision.success && toolDecision.toolCalls.length > 0) {
          // Import FunctionCallingService pour buildContextFromToolResults et generateWithToolResults
          const { FunctionCallingService } =
            await import("../../../services/ai/functionCalling/index.js");
          console.log(`🔧 [SEARCH-PHASE-2] Génération réponse finale...`);

          const toolResults =
            FunctionCallingService.buildContextFromToolResults(
              toolDecision.toolCalls,
            );

          // 📚 Extraire les sources Wikipedia pour l'attribution de licence
          const {
            extractWikipediaSourcesFromToolCalls,
            extractWikipediaSourcesFromRagSources,
          } =
            await import("../../../services/ai/functionCalling/utils/wikipediaExtractor.js");
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
              `📚 [SEARCH-PHASE-2] Aucune source Wikipedia via tools, extraction depuis ragSources...`,
            );
            wikipediaSources =
              await extractWikipediaSourcesFromRagSources(ragSources);
          }

          await FunctionCallingService.generateWithToolResults({
            query: sanitizedQuery,
            toolResults,
            systemPrompt: `System: Réponds de façon claire, précise et structurée, en apportant des détails et de la profondeur à tes explications.

'''${LATEX_STRICT_RULES}'''`,
            wikipediaSources,
            conversationHistory, // 🆕 Injecter l'historique dans phase 2
            personalization: persona, // 🆕 Injecter la personnalisation proprement
            model: "grok-4-1-fast-reasoning", // 🧠 Modèle spécifique demandé
            onStream: (chunk) => {
              fullFinalResponse += chunk; // 🆕 Capturer la réponse
              sseWriteData(res, chunk);
            },
          });

          console.log(`✅ [SEARCH-PHASE-2] Réponse finale streamée`);
        } else {
          // Pas de tools utilisés → réponse directe (fallback)
          console.log(
            `🔧 [SEARCH-FALLBACK] Pas de tools utilisés, génération directe...`,
          );

          // 🔥 Enrichir le context avec les règles LaTeX si pertinent
          let fallbackContext = `System: Réponds de manière claire, précise et structurée en tant qu'assistant IA intelligent.`;
          const persona = await readPersonalizationFromReq(req);
          const personaSnippet = buildPersonaSnippet(persona, 400);
          if (personaSnippet) fallbackContext += "\n\n" + personaSnippet;
          if (isMathLatexIntent(sanitizedQuery)) {
            fallbackContext += "\n\n" + LATEX_STRICT_RULES;
          }

          // 📚 Même en fallback, extraire les sources Wikipedia depuis ragSources pour les licences
          const {
            extractWikipediaSourcesFromRagSources,
            buildWikipediaLicenseFooter,
          } =
            await import("../../../services/ai/functionCalling/utils/wikipediaExtractor.js");
          let wikipediaSources: any[] = [];
          if (ragSources && ragSources.length > 0) {
            wikipediaSources =
              await extractWikipediaSourcesFromRagSources(ragSources);
          }

          // 🆕 Construire le prompt avec historique si disponible
          const historyPrompt = conversationHistory
            ? `📜 HISTORIQUE DE CONVERSATION (CONTEXTE)

Voici l'historique de votre conversation précédente avec l'utilisateur. Utilisez-le pour maintenir la continuité et répondre aux questions qui font référence à cet historique.

${conversationHistory}

---

🎯 QUESTION ACTUELLE :
${sanitizedQuery}`
            : sanitizedQuery;

          await AIService.generateContent({
            prompt: historyPrompt,
            context: fallbackContext,
            temperature: 0.2,
            maxTokens: 4000,
            onStream: (chunk: string) => {
              fullFinalResponse += chunk; // 🆕 Capturer la réponse
              sseWriteData(res, chunk);
            },
          });

          // Ajouter le footer de licence Wikipedia si des sources sont présentes
          if (wikipediaSources.length > 0) {
            const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);
            if (licenseFooter) {
              console.log(
                `📚 [SEARCH-FALLBACK] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`,
              );
              sseWriteData(res, licenseFooter);
              fullFinalResponse += licenseFooter; // 🆕 Capturer le footer
            }
          }
        }

        // 🆕 SAUVEGARDER LA RÉPONSE AI DANS L'HISTORIQUE
        await ConversationHistoryService.addAIMessage(
          userId,
          workspaceId,
          currentThinking,
          currentToolCalls,
          fullFinalResponse,
          intermediateThinkingBlocks,
        );
        console.log(
          `📝 [SEARCH-HISTORY] Réponse AI sauvegardée dans l'historique`,
        );

        // Envoyer les métadonnées pour sauvegarde frontend
        res.write(`event: metadata\n`);
        res.write(
          `data: ${JSON.stringify({
            toolCalls: currentToolCalls,
            thinking: currentThinking,
            usedFallback:
              !toolDecision.success || toolDecision.toolCalls.length === 0,
            intermediateThinkingBlocks: toolDecision.intermediateThinkingBlocks,
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
        console.error("❌ [SEARCH-FUNCTION-CALLING] Erreur:", error);
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
      "search",
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
    console.error("assistantSearchStream error", e);
    try {
      res.write(`event: error\ndata: ${(e as any)?.message || "Erreur"}\n\n`);
    } catch {}
    res.end();
  }
};
