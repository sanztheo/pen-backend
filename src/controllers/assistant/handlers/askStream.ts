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

export const assistantAskStream = async (req: Request, res: Response) => {
  try {
    // 🔍 Validation et parsing unifié avec le nouveau service
    const { request, errors } = AssistantHandlerService.parseRequest(req);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0] });
    }

    const { query, workspaceId, pageIds, useWeb, ragSources } = request;

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(`[ASK] useWeb reçu: ${useWeb} (type: ${typeof useWeb})`);
    DebugLogger.rag(`[ASK] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedQuery = sanitizeUserInput(query);
    const userId = req.user?.id || 'anonymous';

    // 🧠 RAG: Gestion intelligente des sources avec validation unifiée
    let contextPageIds: string[] = [];

    // Si nous avons des sources RAG externes (Wikipedia), ne pas utiliser les pages workspace
    if (ragSources && ragSources.length > 0) {
      DebugLogger.rag('[ASK] Mode RAG externe détecté, pas d\'utilisation des pages workspace');
      contextPageIds = []; // Pas de pages workspace
    } else if (workspaceId && pageIds.length > 0) {
      // 🚀 Validation UUID avec le service unifié
      contextPageIds = ValidationUtils.validatePageIds(pageIds);

      if (contextPageIds.length !== pageIds.length) {
        DebugLogger.rag(`IDs invalides filtrés: ${pageIds.length - contextPageIds.length} IDs ignorés`);
      }
    }

    // 🚀 Construction contexte avec le service unifié
    DebugLogger.web(`[ASK] Déclenchement recherche web - useWeb: ${useWeb}`);

    const contextResult = await AssistantHandlerService.buildContextStrategy('ask', {
      query: sanitizedQuery,
      workspaceId,
      pageIds: contextPageIds,
      useWeb,
      ragSources,
      userId: req.user?.id || 'anonymous'
    });

    DebugLogger.web(`[ASK] Contexte construit - pages: ${contextResult.pages.length}, web: ${contextResult.web.length}, rag: ${contextResult.ragContext?.length || 0}`);

    // 🔧 Extraction sourcesScope du body
    const sourcesScope = (req.body as any)?.sourcesScope || 'custom';
    DebugLogger.rag(`[ASK] sourcesScope: ${sourcesScope}, pageIds: ${pageIds.length}`);

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
      console.log(`🔧 [ASK] Function Calling activé - Pages mentionnées: ${hasSpecificPages}, Mode: ${sourcesScope}`);

      const { FunctionCallingService } = await import('../../../services/ai/functionCalling.js');

      // 🔥 Convertir les pages mentionnées en sources RAG pour l'IA
      let sourcesForAI = ragSources ? ragSources.map(s => ({
        id: s.id || '',
        title: s.title || '',
        type: s.type || 'UNKNOWN'
      })) : [];

      // Si pages spécifiquement mentionnées, les ajouter aux sources pour que l'IA les utilise
      if (hasSpecificPages && contextResult.pageObjects && Array.isArray(contextResult.pageObjects) && contextResult.pageObjects.length > 0) {
        console.log(`📖 [ASK] Ajout des ${contextResult.pageObjects.length} pages mentionnées aux sources pour l'IA`);
        
        // Pour chaque page, s'assurer qu'une RAGSource existe
        const { userPagesRAG } = await import('../../../services/rag/userPages.js');
        const pageContents = await Promise.all(
          contextResult.pageObjects.map(async (p: any) => {
            try {
              // Récupérer le contenu de la page
              const pageData = await prisma.page.findUnique({
                where: { id: p.id },
                select: { title: true, blockNoteContent: true, updatedAt: true }
              });
              
              if (pageData) {
                let textContent = pageData.title || '';
                try {
                  if (pageData.blockNoteContent) {
                    const content = typeof pageData.blockNoteContent === 'string'
                      ? JSON.parse(pageData.blockNoteContent)
                      : pageData.blockNoteContent;
                    if (content && Array.isArray(content)) {
                      const textParts = content
                        .filter((block: any) => block?.type === 'paragraph' && block?.content)
                        .map((block: any) =>
                          Array.isArray(block.content)
                            ? block.content.map((item: any) => item?.text || '').join('')
                            : ''
                        )
                        .filter(Boolean);
                      if (textParts.length > 0) {
                        textContent = (pageData.title || '') + '\n\n' + textParts.join('\n\n');
                      }
                    }
                  }
                } catch (e) {
                  console.log(`⚠️ Erreur extraction contenu page: ${e}`);
                }
                
                // Indexer la page si pas déjà fait
                const ragSourceId = await userPagesRAG.processUserPage({
                  id: p.id,
                  title: pageData.title || 'Sans titre',
                  content: textContent,
                  userId,
                  workspaceId,
                  updatedAt: pageData.updatedAt
                });
                
                return { 
                  id: ragSourceId || p.id,  // Retourner le RAGSource.id ou Page.id en fallback
                  title: pageData.title || p.title || 'Page sans titre',
                  type: 'WORKSPACE_PAGE'
                };
              }
              return { id: p.id, title: p.title, type: 'WORKSPACE_PAGE' };
            } catch (error) {
              console.log(`⚠️ Erreur traitement page "${p.title}": ${error}`);
              return { id: p.id, title: p.title, type: 'WORKSPACE_PAGE' };
            }
          })
        );
        
        const mentionedPagesSources = pageContents.filter(Boolean);
        sourcesForAI = [...mentionedPagesSources, ...sourcesForAI];
      }

      let currentThinking = '';
      let currentToolCalls: any[] = [];

      try {
        // 🔥 PHASE 1: Décision des tools + explication streamée
        console.log(`🔧 [ASK-PHASE-1] Démarrage décision tools avec ${sourcesForAI.length} sources...`);
        
        const toolDecision = await FunctionCallingService.decideAndExecuteTools({
          query: sanitizedQuery,
          availableSources: sourcesForAI,
          workspaceId,
          userId: req.user!.id,
          useWeb,
          systemPrompt: 'Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.',

          // Callbacks pour streaming temps réel
          onThinking: (thinkingChunk) => {
            const timestamp = new Date().toISOString();
            console.log(`⏰ [${timestamp}] 📤 [ASK-PHASE-1] Envoi event thinking, chunk: ${thinkingChunk.slice(0, 50)}...`);
            currentThinking += thinkingChunk;
            res.write(`event: thinking\ndata: ${JSON.stringify({ content: thinkingChunk, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
            console.log(`⏰ [${timestamp}] ✅ [ASK-PHASE-1] Event thinking envoyé + flushed`);
          },

          onToolCall: (toolName, args) => {
            const timestamp = new Date().toISOString();
            console.log(`⏰ [${timestamp}] 📤 [ASK-PHASE-1] Envoi event tool_call: ${toolName}`);
            res.write(`event: tool_call\ndata: ${JSON.stringify({ tool: toolName, args, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          },

          onToolResult: (toolName, toolResult) => {
            const timestamp = new Date().toISOString();
            console.log(`⏰ [${timestamp}] 📤 [ASK-PHASE-1] Envoi event tool_result: ${toolName}`);
            const truncated = toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult;
            res.write(`event: tool_result\ndata: ${JSON.stringify({ tool: toolName, result: truncated, timestamp })}\n\n`);
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          }
        });

        currentToolCalls = toolDecision.toolCalls;
        console.log(`✅ [ASK-PHASE-1] Terminé: ${toolDecision.toolCalls.length} tools exécutés, shouldUseTools: ${toolDecision.shouldUseTools}`);

        // 🔥 PHASE 2: Génération réponse finale avec résultats des tools
        if (toolDecision.shouldUseTools && toolDecision.toolCalls.length > 0) {
          console.log(`🔧 [ASK-PHASE-2] Génération réponse finale...`);
          
          const toolResults = FunctionCallingService.buildContextFromToolResults(toolDecision.toolCalls);
          
          await FunctionCallingService.generateWithToolResults({
            query: sanitizedQuery,
            toolResults,
            systemPrompt: 'Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.',
            onStream: (chunk) => {
              sseWriteData(res, chunk);
            }
          });

          console.log(`✅ [ASK-PHASE-2] Réponse finale streamée`);
        } else {
          // Pas de tools utilisés → réponse directe (fallback)
          console.log(`🔧 [ASK-FALLBACK] Pas de tools utilisés, génération directe...`);
          
          await AIService.generateContent({
            prompt: sanitizedQuery,
            context: 'Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.',
            temperature: 0.2,
            maxTokens: 4000,
            onStream: (chunk: string) => {
              sseWriteData(res, chunk);
            }
          });
        }

        // Envoyer les métadonnées pour sauvegarde frontend
        res.write(`event: metadata\n`);
        res.write(`data: ${JSON.stringify({
          toolCalls: currentToolCalls,
          thinking: currentThinking,
          usedFallback: !toolDecision.shouldUseTools
        })}\n\n`);

        try {
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'user', sanitizedQuery);
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'assistant', '');
        } catch { }

        res.write('event: done\n\n');
        res.end();
        return;

      } catch (error) {
        console.error('❌ [FUNCTION-CALLING] Erreur:', error);
        // Fallback sur système classique ci-dessous
      }
    }

    // 🎯 Système classique (si pas de sources RAG ou erreur Function Calling)
    const history = ConversationMemory.recentAsText(req.user?.id || 'anonymous', { maxChars: 1200, maxMessages: 8 });

    // 🎯 OPTIMISATION COMPLÈTE: Prompt avec troncature intelligente garantie
    // 🔥 INCLURE le contexte RAG (fichiers, Wikipedia) si disponible
    const contextWithWeb = [contextResult.ragContext, contextResult.pages, contextResult.web].filter(Boolean).join('\n\n');
    const optimizedPrompt = optimizePrompt('ask', sanitizedQuery, contextWithWeb, history, req);

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
    console.error('assistantAskStream error', e);
    try { res.write(`event: error\ndata: ${(e as any)?.message || 'Erreur'}\n\n`); } catch {}
    res.end();
  }
};
