/**
 * 🔍 SEARCH STREAM HANDLER - REFACTORISÉ
 * Handler unifié pour la recherche avec RAG + Web + Workspace
 */

import { Request, Response } from 'express';
import { AIService } from '../../../services/ai/index.js';
import { ConversationMemory } from '../../../services/ai/conversationMemory.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { tavilySearch } from '../helpers/web.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { sseWriteData } from '../helpers/sse.js';
import { formatAIStreamChunk } from '../helpers/format.js';
import { sanitizeUserInput, analyzeQuery, optimizePrompt } from '../helpers/promptOptimizer.js';

// 🚀 NOUVEAUX SERVICES (refactoring architecture)
import { DebugLogger } from '../config/debug.js';
import { ValidationUtils } from '../utils/validation.js';
import { AssistantHandlerService } from '../services/HandlerService.js';
import { prisma } from '../../../lib/prisma.js';
import { indexAndPreparePagesForAI } from '../helpers/pageIndexing.js';

export const assistantSearchStream = async (req: Request, res: Response) => {
  try {
    // 🔍 Validation et parsing unifié avec le nouveau service
    const { request, errors } = AssistantHandlerService.parseRequest(req);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const { query, workspaceId, pageIds, useWeb, ragSources } = request;

    // 🔍 DEBUG COMPLET DU FRONTEND
    console.log(`\n\n🔍 [SEARCH-DEBUG-FRONTEND] ========== REQUÊTE DU FRONTEND ==========`);
    console.log(`📨 pageIds reçus: ${JSON.stringify(pageIds)} (${pageIds.length})`);
    console.log(`📨 ragSources reçus: ${JSON.stringify(ragSources)} (${ragSources.length})`);
    console.log(`📨 sourcesScope reçu: ${(req.body as any)?.sourcesScope}`);
    console.log(`📨 query: "${query.slice(0, 50)}..."`);
    console.log(`🔍 [SEARCH-DEBUG-FRONTEND] ========== FIN REQUÊTE ==========\n`);

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(`[SEARCH] useWeb reçu: ${useWeb} (type: ${typeof useWeb})`);
    DebugLogger.rag(`[SEARCH] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedQuery = sanitizeUserInput(query);
    const userId = req.user?.id || 'anonymous';

    // 🧠 RAG: Gestion intelligente des sources avec validation unifiée
    let contextPageIds: string[] = [];

    // 🔥 PRIORITÉ: Pages mentionnées > Sources RAG externes
    // Les pages workspace mentionnées ont TOUJOURS la priorité
    if (workspaceId && pageIds.length > 0) {
      // 🚀 Validation UUID avec le service unifié
      contextPageIds = ValidationUtils.validatePageIds(pageIds);

      if (contextPageIds.length !== pageIds.length) {
        DebugLogger.rag(`IDs invalides filtrés: ${pageIds.length - contextPageIds.length} IDs ignorés`);
      }
    } 
    // Seulement si PAS de pages mentionnées, utiliser les sources RAG externes
    else if (ragSources && ragSources.length > 0) {
      DebugLogger.rag('[SEARCH] Pas de pages mentionnées - Mode RAG externe détecté');
      contextPageIds = []; // Pas de pages workspace
    }

    // 🚀 Construction contexte avec le service unifié
    DebugLogger.web(`[SEARCH] Déclenchement recherche web - useWeb: ${useWeb}`);

    const contextResult = await AssistantHandlerService.buildContextStrategy('search', {
      query: sanitizedQuery,
      workspaceId,
      pageIds: contextPageIds,
      useWeb,
      ragSources,
      userId: req.user?.id || 'anonymous'
    });

    DebugLogger.web(`[SEARCH] Contexte construit - pages: ${contextResult.pages.length}, web: ${contextResult.web.length}, rag: ${contextResult.ragContext?.length || 0}`);

    // 🔧 Extraction sourcesScope du body
    const sourcesScope = (req.body as any)?.sourcesScope || 'custom';
    DebugLogger.rag(`[SEARCH] sourcesScope: ${sourcesScope}, pageIds: ${pageIds.length}`);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    // 🔥 TWO-PHASE Function Calling SEULEMENT si:
    // 1. Mode "Toutes les sources" (sourcesScope='all') OU
    // 2. Pages spécifiquement mentionnées OU
    // 3. Sources RAG disponibles (Wikipedia, fichiers, etc)
    const hasSpecificPages = contextPageIds.length > 0;
    const shouldUseFunctionCalling = 
      (sourcesScope === 'all' && ragSources && ragSources.length > 0) ||
      hasSpecificPages ||
      (contextPageIds.length === 0 && ragSources && ragSources.length > 0);
    
    if (shouldUseFunctionCalling) {
      console.log(`🔧 [SEARCH] Function Calling activé - Pages mentionnées: ${hasSpecificPages}, Mode: ${sourcesScope}`);

      const { FunctionCallingService } = await import('../../../services/ai/functionCalling/index.js');

      // 🔥 Convertir les pages mentionnées en sources RAG pour l'IA
      // IMPORTANT: Si des pages spécifiques sont mentionnées, utiliser SEULEMENT ces pages
      // Pas les sources RAG externes
      let sourcesForAI: any[] = [];
      
      // Vérifier d'abord s'il y a des pages spécifiquement mentionnées
      // (hasSpecificPages est déjà déclaré à la ligne 82)
      
      if (hasSpecificPages && contextResult.pageObjects && Array.isArray(contextResult.pageObjects) && contextResult.pageObjects.length > 0) {
        console.log(`📖 [SEARCH] Pages spécifiques détectées - utiliser SEULEMENT ces pages, pas les sources RAG`);
        
        // Pour chaque page, s'assurer qu'une RAGSource existe
        sourcesForAI = await indexAndPreparePagesForAI(contextResult.pageObjects, userId, workspaceId);
      } else if (ragSources && ragSources.length > 0) {
        // Si PAS de pages spécifiques, utiliser les sources RAG externes
        console.log(`🔧 [SEARCH] Pas de pages spécifiques - utiliser les sources RAG externes`);
        sourcesForAI = ragSources.map(s => ({
          id: s.id || '',
          title: s.title || '',
          type: s.type || 'UNKNOWN'
        }));
      }

      let currentThinking = '';
      let currentToolCalls: any[] = [];

      try {
        // 🔥 PHASE 1: Décision des tools + explication streamée
        console.log(`🔧 [SEARCH-PHASE-1] Démarrage décision tools avec ${sourcesForAI.length} sources...`);
        
        const toolDecision = await FunctionCallingService.decideAndExecuteTools({
          query: sanitizedQuery,
          availableSources: sourcesForAI,
          workspaceId,
          userId: req.user!.id,
          useWeb,
          systemPrompt: `Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.\n\n${LATEX_STRICT_RULES}`,
          isSearch: true,  // 🔥 Flag pour Search - utilise plus de tools

          // Callbacks pour streaming temps réel
          onThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            currentThinking += thinkingChunk;
            res.write(`event: thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          },

          onToolCall: (toolName, args) => {
            const timestamp = new Date().toISOString();
            res.write(`event: tool_call\ndata: ${JSON.stringify({ tool: toolName, args, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          },

          onToolResult: (toolName, toolResult) => {
            const timestamp = new Date().toISOString();
            const truncated = toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult;
            res.write(`event: tool_result\ndata: ${JSON.stringify({ tool: toolName, result: truncated, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          },

          // 🔥 NEW: Thinking intermédiaire entre les requêtes
          onIntermediateThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            res.write(`event: intermediate_thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          }
        });

        currentToolCalls = toolDecision.toolCalls;
        console.log(`✅ [SEARCH-PHASE-1] Terminé: ${toolDecision.toolCalls.length} tools exécutés, shouldUseTools: ${toolDecision.shouldUseTools}`);

        // 🔥 PHASE 2: Génération réponse finale avec résultats des tools
        if (toolDecision.shouldUseTools && toolDecision.toolCalls.length > 0) {
          console.log(`🔧 [SEARCH-PHASE-2] Génération réponse finale...`);

          const toolResults = FunctionCallingService.buildContextFromToolResults(toolDecision.toolCalls);

          // 📚 Extraire les sources Wikipedia pour l'attribution de licence
          const { extractWikipediaSourcesFromToolCalls, extractWikipediaSourcesFromRagSources } = await import('../../../services/ai/functionCalling/utils/wikipediaExtractor.js');
          let wikipediaSources = await extractWikipediaSourcesFromToolCalls(toolDecision.toolCalls);

          // Si aucune source Wikipedia trouvée via tools, extraire depuis ragSources
          if (wikipediaSources.length === 0 && ragSources && ragSources.length > 0) {
            console.log(`📚 [SEARCH-PHASE-2] Aucune source Wikipedia via tools, extraction depuis ragSources...`);
            wikipediaSources = await extractWikipediaSourcesFromRagSources(ragSources);
          }

          await FunctionCallingService.generateWithToolResults({
            query: sanitizedQuery,
            toolResults,
            systemPrompt: `Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée avec plus de détails et de profondeur.\n\n${LATEX_STRICT_RULES}`,
            wikipediaSources,
            onStream: (chunk) => {
              sseWriteData(res, chunk);
            }
          });

          console.log(`✅ [SEARCH-PHASE-2] Réponse finale streamée`);
        } else {
          // Pas de tools utilisés → réponse directe (fallback)
          console.log(`🔧 [SEARCH-FALLBACK] Pas de tools utilisés, génération directe...`);

          // 🔥 Enrichir le context avec les règles LaTeX si pertinent
          let fallbackContext = 'Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.';
          if (isMathLatexIntent(sanitizedQuery)) {
            fallbackContext += '\n\n' + LATEX_STRICT_RULES;
          }

          // 📚 Même en fallback, extraire les sources Wikipedia depuis ragSources pour les licences
          const { extractWikipediaSourcesFromRagSources, buildWikipediaLicenseFooter } = await import('../../../services/ai/functionCalling/utils/wikipediaExtractor.js');
          let wikipediaSources: any[] = [];
          if (ragSources && ragSources.length > 0) {
            wikipediaSources = await extractWikipediaSourcesFromRagSources(ragSources);
          }

          let fullAnswer = '';
          await AIService.generateContent({
            prompt: sanitizedQuery,
            context: fallbackContext,
            temperature: 0.2,
            maxTokens: 4000,
            onStream: (chunk: string) => {
              fullAnswer += chunk;
              sseWriteData(res, chunk);
            }
          });

          // Ajouter le footer de licence Wikipedia si des sources sont présentes
          if (wikipediaSources.length > 0) {
            const licenseFooter = buildWikipediaLicenseFooter(wikipediaSources);
            if (licenseFooter) {
              console.log(`📚 [SEARCH-FALLBACK] Ajout footer licence Wikipedia (${wikipediaSources.length} sources)`);
              sseWriteData(res, licenseFooter);
              fullAnswer += licenseFooter;
            }
          }
        }

        // Envoyer les métadonnées pour sauvegarde frontend
        res.write(`event: metadata\n`);
        res.write(`data: ${JSON.stringify({
          toolCalls: currentToolCalls,
          thinking: currentThinking,
          usedFallback: !toolDecision.shouldUseTools,
          intermediateThinkingBlocks: toolDecision.intermediateThinkingBlocks
        })}\n\n`);

        try {
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'user', sanitizedQuery);
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'assistant', '');
        } catch { }

        res.write('event: done\n\n');
        res.end();
        return;

      } catch (error) {
        console.error('❌ [SEARCH-FUNCTION-CALLING] Erreur:', error);
        // Fallback sur système classique ci-dessous
      }
    }

    // 🎯 Système classique (si pas de sources RAG ou erreur Function Calling)
    const history = ConversationMemory.recentAsText(req.user?.id || 'anonymous', { maxChars: 1200, maxMessages: 8 });

    // 🎯 OPTIMISATION COMPLÈTE: Prompt avec troncature intelligente garantie
    // 🔥 INCLURE le contexte RAG (fichiers, Wikipedia) si disponible
    const contextWithWeb = [contextResult.ragContext, contextResult.pages, contextResult.web].filter(Boolean).join('\n\n');
    const optimizedPrompt = optimizePrompt('search', sanitizedQuery, contextWithWeb, history, req);

    let fullAnswer = '';
    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: optimizedPrompt.systemMessage,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = formatAIStreamChunk(chunk);
        fullAnswer += normalized;
        sseWriteData(res, normalized);
      }
    });
    try {
      ConversationMemory.addMessage(req.user?.id || 'anonymous', 'user', sanitizedQuery);
      ConversationMemory.addMessage(req.user?.id || 'anonymous', 'assistant', fullAnswer.trim());
    } catch { }
    res.write('event: done\n\n');
    res.end();
  } catch (e) {
    console.error('assistantSearchStream error', e);
    try { res.write(`event: error\ndata: ${(e as any)?.message || 'Erreur'}\n\n`); } catch {}
    res.end();
  }
};