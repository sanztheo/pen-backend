/**
 * 🔍 SEARCH STREAM HANDLER - REFACTORISÉ
 * Handler unifié pour la recherche avec RAG + Web + Workspace
 */

import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { sseWriteData } from '../helpers/sse.js';
import { formatAIStreamChunk, formatItalicReferences } from '../helpers/format.js';
import { sanitizeUserInput, analyzeQuery, buildOptimizedPrompt } from '../helpers/promptOptimizer.js';
import { AssistantHandlerService } from '../services/HandlerService.js';
import { SourceSelectionService } from '../services/SourceSelectionService.js';
import { DebugLogger } from '../config/debug.js';

export const assistantSearchStream = async (req: Request, res: Response) => {
  try {
    // 🔧 REFACTOR: Validation et parsing unifié
    const { request, errors } = AssistantHandlerService.parseRequest(req);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(', ') });
    }

    const { query, workspaceId, pageIds, useWeb, ragSources, userId } = request;

    // 🔍 REFACTOR: Debug unifié
    AssistantHandlerService.traceWebParams('SEARCH', request);

    DebugLogger.performance(`[SEARCH] ENTRÉE - workspaceId: ${workspaceId}, pageIds: ${pageIds.length}, ragSources: ${ragSources.length}`);

    // 🛡️ SÉCURITÉ: Nettoyage unifié
    const sanitizedQuery = sanitizeUserInput(query);

    // 🧠 INTELLIGENCE: Analyse unifié
    const analysis = analyzeQuery(sanitizedQuery, req);

    // 🔥 REFACTOR: Récupération session RAG si nécessaire
    let effectiveRagSources = ragSources;
    if ((!ragSources || ragSources.length === 0) && userId) {
      try {
        DebugLogger.rag('Pas de sources RAG explicites, vérification session active');
        const { sessionMemory } = await import('../../../services/rag/sessionMemory.js');
        const activeSession = await sessionMemory.getActiveSession(userId, workspaceId);

        if (activeSession) {
          DebugLogger.rag(`Session RAG active trouvée: ${activeSession.id}`);
          const sessionSources = await sessionMemory.getSessionSources(activeSession.id);
          if (sessionSources && sessionSources.length > 0) {
            effectiveRagSources = sessionSources.map(source => ({
              title: source.title,
              type: source.type,
              id: source.id
            }));
            DebugLogger.rag('Sources récupérées de la session:', effectiveRagSources.map(s => s.title));
          }
        }
      } catch (error) {
        DebugLogger.rag('Erreur récupération session RAG:', error);
      }
    }

    // 🎯 REFACTOR: Sélection de sources avec strategy pattern
    const sourceSelection = await SourceSelectionService.selectSources({
      query: sanitizedQuery,
      workspaceId,
      userId,
      ragSources: effectiveRagSources,
      sourcesScope: (req.body as any)?.sourcesScope,
      selectedPageIds: pageIds
    });

    DebugLogger.rag(`Stratégie sélectionnée: ${sourceSelection.strategy}, pages: ${sourceSelection.selectedPageIds.length}, RAG: ${sourceSelection.ragSources.length}`);

    // 🧠 RAG: Auto-embedding asynchrone pour pages workspace
    if (sourceSelection.selectedPageIds.length > 0 && sourceSelection.strategy !== 'rag') {
      try {
        await processUserPagesEmbedding(sourceSelection.selectedPageIds, workspaceId, userId);
      } catch (error) {
        DebugLogger.embedding('Erreur embedding pages:', error);
      }
    }

    // 🏗️ REFACTOR: Construction contexte unifié
    const contextResult = await AssistantHandlerService.buildContextStrategy('search', {
      query: sanitizedQuery,
      workspaceId,
      pageIds: sourceSelection.selectedPageIds,
      useWeb,
      ragSources: sourceSelection.ragSources,
      userId
    });

    // 🏗️ STRUCTURE: Prompt optimisé
    const contextWithWeb = [contextResult.pageContext, contextResult.ragContext, contextResult.webContext]
      .filter(Boolean)
      .join('\n\n');
    const optimizedPrompt = buildOptimizedPrompt('search', sanitizedQuery, contextWithWeb, '', analysis);

    // 📡 SSE Setup
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    // 🔄 Status steps
    const steps = [
      'Analyse la requête et le contexte',
      'Recherche des passages pertinents dans tes pages',
      useWeb ? 'Explore des sources web fiables' : 'Se limite aux pages du workspace',
      'Sélectionne les éléments clés',
      'Rédige une réponse claire et structurée'
    ];

    try {
      for (const step of steps) {
        res.write(`event: status\n`);
        res.write(`data: ${step}\n\n`);
        if ((res as any).flush) {
          (res as any).flush();
        }
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (error) {
      DebugLogger.performance('Erreur status steps:', error);
    }

    // 🤖 AI Generation
    let fullResponse = '';
    DebugLogger.performance('[SEARCH] Début streaming vers client');

    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: optimizedPrompt.systemMessage,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = formatAIStreamChunk(chunk);
        fullResponse += normalized;
        sseWriteData(res, normalized);
      }
    });

    DebugLogger.performance(`[SEARCH] Streaming terminé, longueur: ${fullResponse.length}`);

    // 📚 Références finales
    await sendReferences(res, sourceSelection.selectedPageIds, contextResult.webRefs || [], sanitizedQuery);

    res.write('event: done\n\n');
    DebugLogger.performance('[SEARCH] Événement done envoyé');
    res.end();

  } catch (error) {
    DebugLogger.rag('Erreur assistantSearchStream:', error);
    try {
      res.write(`event: error\ndata: ${(error as any)?.message || 'Erreur'}\n\n`);
    } catch (writeError) {
      DebugLogger.rag('Erreur écriture erreur SSE:', writeError);
    }
    res.end();
  }
};

/**
 * 🧠 REFACTOR: Embedding asynchrone des pages utilisateur
 */
async function processUserPagesEmbedding(pageIds: string[], workspaceId: string, userId: string) {
  try {
    const { userPagesRAG } = await import('../../../services/rag/userPages.js');

    // Récupération des pages
    const pages = await prisma.page.findMany({
      where: {
        id: { in: pageIds },
        workspaceId,
        isArchived: false
      },
      select: {
        id: true,
        title: true,
        blockNoteContent: true,
        updatedAt: true
      }
    });

    // Traitement asynchrone
    pages.forEach(page => {
      if (page.title && page.title.length > 10) {
        let textContent = page.title;

        try {
          if (page.blockNoteContent) {
            const content = typeof page.blockNoteContent === 'string'
              ? JSON.parse(page.blockNoteContent)
              : page.blockNoteContent;

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
                textContent = page.title + '\n\n' + textParts.join('\n\n');
              }
            }
          }
        } catch (error) {
          DebugLogger.embedding(`Erreur extraction contenu page "${page.title}":`, error);
        }

        userPagesRAG.processUserPage({
          id: page.id,
          title: page.title,
          content: textContent,
          userId,
          workspaceId,
          updatedAt: page.updatedAt
        }).catch(error => {
          DebugLogger.embedding(`Erreur embedding page "${page.title}":`, error);
        });
      }
    });

    DebugLogger.embedding(`Embedding déclenché pour ${pages.length} pages sélectionnées`);
  } catch (error) {
    DebugLogger.embedding('Erreur processUserPagesEmbedding:', error);
  }
}

/**
 * 📚 REFACTOR: Envoi des références unifié
 */
async function sendReferences(
  res: Response,
  selectedPageIds: string[],
  webRefs: Array<{ title?: string; url?: string }>,
  sanitizedQuery: string
) {
  try {
    // Extraire les références Wikipedia du query
    const wikipediaRefs: { title: string }[] = [];
    const wikipediaMatches = sanitizedQuery.match(/\*\*(.*?)\*\* \(Wikipedia\)/g);
    if (wikipediaMatches) {
      wikipediaRefs.push(...wikipediaMatches.map(match => ({
        title: match.replace(/\*\*(.*?)\*\* \(Wikipedia\)/, '$1')
      })));
    }

    // Références des pages
    const refPages = await prisma.page.findMany({
      where: { id: { in: selectedPageIds } },
      select: { id: true, title: true }
    });
    const pageRefs = refPages.map(p => ({ title: p.title }));

    // Debug références finales
    DebugLogger.web(`Références finales - Pages: ${pageRefs.length}, Web: ${webRefs.length}, Wikipedia: ${wikipediaRefs.length}`);

    // Formatage et envoi
    const allRefs = [
      ...pageRefs,
      ...webRefs.filter(ref => ref.title), // Filtrer les références web sans titre
      ...wikipediaRefs
    ].map(ref => ({ title: ref.title || '', url: 'url' in ref ? ref.url : undefined }));

    const refsBlock = formatItalicReferences(allRefs);
    if (refsBlock) {
      sseWriteData(res, refsBlock);
      DebugLogger.performance(`Bloc références envoyé, longueur: ${refsBlock.length}`);
    }
  } catch (error) {
    DebugLogger.rag('Erreur sendReferences:', error);
  }
}