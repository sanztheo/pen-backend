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

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    // 🔥 NOUVEAU: Mode Function Calling si des sources RAG sont disponibles
    if (ragSources && ragSources.length > 0) {
      console.log(`🔧 [ASK] Mode Function Calling activé (${ragSources.length} sources)`);

      const { FunctionCallingService } = await import('../../../services/ai/functionCalling.js');

      let currentThinking = '';

      // 🔥 Envoyer un event status AVANT pour préparer l'UI
      res.write(`event: status\n`);
      res.write(`data: 🔧 Analyse des sources...\n\n`);

      try {
        const result = await FunctionCallingService.generateWithTools({
          query: sanitizedQuery,
          availableSources: ragSources.map(s => ({
            id: s.id || '',
            title: s.title || '',
            type: s.type || 'UNKNOWN'
          })),
          workspaceId,
          userId: req.user!.id,
          useWeb,
          systemPrompt: 'Tu es un assistant IA intelligent. Réponds de manière claire, précise et structurée.',
          timeoutMs: 5000, // Fallback après 5s

          // Callbacks pour streaming temps réel
          onThinking: (thinking) => {
            currentThinking = thinking;
            res.write(`event: thinking\n`);
            res.write(`data: ${JSON.stringify({ content: thinking })}\n\n`);
            res.write(': keepalive\n\n'); // 🔥 Commentaire SSE pour forcer le flush
          },

          onToolCall: (toolName, args) => {
            console.log(`📤 [SSE] Envoi event tool_call: ${toolName}`);
            res.write(`event: tool_call\n`);
            res.write(`data: ${JSON.stringify({ tool: toolName, args })}\n\n`);
            res.write(': keepalive\n\n'); // 🔥 Commentaire SSE pour forcer le flush
            console.log(`📤 [SSE] Event tool_call envoyé`);
          },

          onToolResult: (toolName, toolResult) => {
            console.log(`📤 [SSE] Envoi event tool_result: ${toolName}`);
            const truncated = toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult;
            res.write(`event: tool_result\n`);
            res.write(`data: ${JSON.stringify({ tool: toolName, result: truncated })}\n\n`);
            res.write(': keepalive\n\n'); // 🔥 Commentaire SSE pour forcer le flush
            console.log(`📤 [SSE] Event tool_result envoyé`);
          }
        });

        // Streamer le contenu final caractère par caractère (effet typewriter)
        for (const char of result.content) {
          sseWriteData(res, char);
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        // Envoyer les métadonnées pour sauvegarde frontend
        res.write(`event: metadata\n`);
        res.write(`data: ${JSON.stringify({
          toolCalls: result.toolCalls,
          thinking: currentThinking,
          usedFallback: result.usedFallback
        })}\n\n`);

        try {
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'user', sanitizedQuery);
          ConversationMemory.addMessage(req.user?.id || 'anonymous', 'assistant', result.content.trim());
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
