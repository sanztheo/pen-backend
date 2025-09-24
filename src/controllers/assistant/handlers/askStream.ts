import { Request, Response } from 'express';
import { AIService } from '../../../services/ai/index.js';
import { ConversationMemory } from '../../../services/ai/conversationMemory.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { tavilySearch } from '../helpers/web.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { sseWriteData } from '../helpers/sse.js';
import { formatAIStreamChunk } from '../helpers/format.js';
import { sanitizeUserInput, analyzeQuery, buildOptimizedPrompt } from '../helpers/promptOptimizer.js';

export const assistantAskStream = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { query, workspaceId, pageIds = [], useWeb = false, ragSources = [] } = req.body as {
      query: string;
      workspaceId: string;
      pageIds?: (string | number)[];
      useWeb?: boolean;
      ragSources?: Array<{ title: string; [key: string]: any }>;
    };
    if (!query) return res.status(400).json({ error: 'query requis' });

    // Convert pageIds to strings to ensure Prisma compatibility
    const pageIdsStr = pageIds.map(id => String(id));

    console.log(`🔥 [ASK-STREAM] ENTRÉE - workspaceId: ${workspaceId}, pageIds: [${pageIdsStr.join(', ')}], pageIds.length: ${pageIdsStr.length}, ragSources.length: ${ragSources.length}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedQuery = sanitizeUserInput(query);

    // 🧠 INTELLIGENCE: Analyse de la requête
    const analysis = analyzeQuery(sanitizedQuery, req);

    // 🧠 RAG: Gestion intelligente des sources
    let contextPageIds: string[] = [];

    // Si nous avons des sources RAG externes (Wikipedia), ne pas utiliser les pages workspace
    if (ragSources && ragSources.length > 0) {
      console.log('[ASK-STREAM] Mode RAG externe détecté, pas d\'utilisation des pages workspace');
      contextPageIds = []; // Pas de pages workspace
    } else if (workspaceId && pageIdsStr.length > 0) {
      // Valider que les pageIds sont des UUIDs valides avant de les utiliser
      const validPageIds = pageIdsStr.filter(id => {
        // Simple validation UUID (32 chars + hyphens = 36 chars total)
        return id.length === 36 && id.includes('-');
      });

      if (validPageIds.length !== pageIdsStr.length) {
        console.log(`⚠️ [ASK-STREAM] IDs invalides filtrés: ${pageIdsStr.length - validPageIds.length} IDs ignorés`);
      }

      contextPageIds = validPageIds;
    }

    const [ctx, web] = await Promise.all([
      workspaceId && contextPageIds.length > 0 ? buildPagesContextChunked(workspaceId, contextPageIds, 8, sanitizedQuery, 10) : Promise.resolve(''),
      useWeb ? tavilySearch(sanitizedQuery) : Promise.resolve('')
    ]);
    const history = ConversationMemory.recentAsText(req.user.id, { maxChars: 1200, maxMessages: 8 });

    // 🏗️ STRUCTURE: Construction du prompt optimisé avec RAG + Web dans context
    const contextWithWeb = [ctx, web].filter(Boolean).join('\n\n');
    const optimizedPrompt = buildOptimizedPrompt('ask', sanitizedQuery, contextWithWeb, history, analysis);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

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
      ConversationMemory.addMessage(req.user.id, 'user', sanitizedQuery);
      ConversationMemory.addMessage(req.user.id, 'assistant', fullAnswer.trim());
    } catch {}
    res.write('event: done\n\n');
    res.end();
  } catch (e) {
    console.error('assistantAskStream error', e);
    try { res.write(`event: error\ndata: ${(e as any)?.message || 'Erreur'}\n\n`); } catch {}
    res.end();
  }
};
