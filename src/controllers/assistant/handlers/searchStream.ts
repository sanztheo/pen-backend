import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { selectRelevantPagesWithAssistant } from '../../../services/ai/assistants/selectPages.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { tavilySearchRefs } from '../helpers/web.js';
import { titleRelevanceScore } from '../helpers/scoring.js';
import { sseWriteData } from '../helpers/sse.js';
import { formatAIStreamChunk, formatItalicReferences } from '../helpers/format.js';
import { sanitizeUserInput, analyzeQuery, buildOptimizedPrompt } from '../helpers/promptOptimizer.js';

export const assistantSearchStream = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { query, workspaceId, pageIds = [], useWeb = true, ragSources = [] } = req.body as { 
      query: string; 
      workspaceId: string; 
      pageIds?: string[]; 
      useWeb?: boolean;
      ragSources?: Array<{ title: string; [key: string]: any }>;
    };
    if (!query || !workspaceId) return res.status(400).json({ error: 'query et workspaceId requis' });

    console.log(`🔥 [SEARCH-STREAM] ENTRÉE - workspaceId: ${workspaceId}, pageIds: [${pageIds.join(', ')}], pageIds.length: ${pageIds.length}, ragSources.length: ${ragSources.length}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedQuery = sanitizeUserInput(query);
    
    // 🧠 INTELLIGENCE: Analyse de la requête
    const analysis = analyzeQuery(sanitizedQuery, req);

    const lang = detectPreferredLanguage(req);
    let selectedIds2: string[] = pageIds;
    
    // 🧠 RAG: Les pages sont maintenant embedées automatiquement à la sélection (frontend)
    
    // 🔥 NOUVEAU: Si nous avons des sources RAG et que ce n'est pas "toutes les sources", utiliser uniquement les sources RAG
    if (ragSources && ragSources.length > 0 && (req.body as any)?.sourcesScope !== 'all') {
      console.log('[AssistantSearchStream] Utilisation des sources RAG:', ragSources.map(s => s.title));
      
      // Chercher les pages correspondantes aux sources RAG par titre
      const ragTitles = ragSources.map(s => s.title);
      const ragPages = await prisma.page.findMany({
        where: { 
          workspaceId, 
          isArchived: false,
          title: { in: ragTitles }
        },
        select: { id: true, title: true }
      });
      
      selectedIds2 = ragPages.map(p => p.id);
      console.log('[AssistantSearchStream] Pages RAG trouvées:', ragPages.map(p => p.title));
      
      // Si aucune page trouvée par titre, chercher les IDs de pageIds fournis
      if (selectedIds2.length === 0 && pageIds && pageIds.length > 0) {
        console.log('[AssistantSearchStream] Fallback vers pageIds fournis:', pageIds);
        selectedIds2 = pageIds;
      }
    }
    // 🔥 CORRIGÉ: Logique stricte pour "toutes les sources" UNIQUEMENT si sourcesScope === 'all'
    else if ((req.body as any)?.sourcesScope === 'all') {
      console.log('[AssistantSearchStream] selection step (all sources)');
      const all = await prisma.page.findMany({ where: { workspaceId, isArchived: false }, select: { id: true, title: true }, orderBy: { updatedAt: 'desc' }, take: 200 });
      const sel = await selectRelevantPagesWithAssistant({ question: sanitizedQuery, pages: all.map(p => ({ id: p.id, title: p.title })), maxResults: 5 });
      const initialSelected2 = (sel.selected || []);
      let pruned2 = initialSelected2
        .map(p => ({ ...p, score: titleRelevanceScore(p.title, sanitizedQuery) }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => p.id);
      console.log('[AssistantSearchStream] IA selection (raw)=', initialSelected2.map(p => p.title));
      console.log('[AssistantSearchStream] IA selection pruned (ids.len)=', pruned2.length);
      selectedIds2 = pruned2;
      if (!selectedIds2.length || selectedIds2.length === all.length) {
        console.log('[AssistantSearchStream] AI selection failed, using smart fallback');
        const score = (title: string) => {
          const queryWords = (sanitizedQuery || '').toLowerCase()
            .split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/)
            .filter(w => w.length >= 2);
          const titleLower = (title || '').toLowerCase();
          let totalScore = 0;
          for (const word of queryWords) {
            if (titleLower.includes(word)) {
              totalScore += word.length * 2;
            }
            const wordParts = word.split('');
            let partialMatch = 0;
            for (const char of wordParts) {
              if (titleLower.includes(char)) partialMatch++;
            }
            totalScore += (partialMatch / word.length) * 0.5;
          }
          return totalScore;
        };
        const scored = all.map(p => ({ ...p, score: score(p.title) }))
          .filter(p => p.score > 0)
          .sort((a, b) => b.score - a.score);
        selectedIds2 = scored.slice(0, Math.min(5, scored.length)).map(p => p.id);
        console.log('[AssistantSearchStream] fallback selection:', scored.slice(0,5).map(p => `${p.title} (${p.score})`));
        if (!selectedIds2.length) {
          selectedIds2 = all.slice(0, 3).map(p => p.id);
          console.log('[AssistantSearchStream] final fallback: recent pages');
        }
      }
      console.log('[AssistantSearchStream] selectedIds.len=', selectedIds2.length);
    }
    // 🔥 NOUVEAU: Si pas de sources sélectionnées et pas "toutes les sources", utiliser un fallback minimal
    else if (!selectedIds2 || selectedIds2.length === 0) {
      console.log('[AssistantSearchStream] Aucune source sélectionnée et pas en mode "toutes les sources"');
      // Fallback : ne prendre aucune page ou retourner une erreur
      selectedIds2 = [];
    }

    // 🧠 RAG: Auto-embedding des pages sélectionnées (mode asynchrone)
    if (selectedIds2.length > 0) {
      try {
        const { userPagesRAG } = await import('../../../services/rag/userPages.js');
        
        // Récupérer les informations des pages sélectionnées
        const selectedPages = await prisma.page.findMany({
          where: {
            id: { in: selectedIds2 },
            workspaceId: workspaceId,
            isArchived: false
          },
          select: {
            id: true,
            title: true,
            blockNoteContent: true,
            updatedAt: true
          }
        });

        // Traitement asynchrone des embeddings (pas bloquant)
        selectedPages.forEach(page => {
          if (page.title && page.title.length > 10) {
            // Extraire le contenu texte depuis blockNoteContent si disponible
            let textContent = page.title;
            try {
              if (page.blockNoteContent) {
                const content = typeof page.blockNoteContent === 'string' 
                  ? JSON.parse(page.blockNoteContent) 
                  : page.blockNoteContent;
                
                // Extraction basique du texte depuis BlockNote content
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
              console.error(`🧠 [RAG] Erreur extraction contenu page "${page.title}":`, error);
            }

            userPagesRAG.processUserPage({
              id: page.id,
              title: page.title,
              content: textContent,
              userId: req.user!.id,
              workspaceId: workspaceId,
              updatedAt: page.updatedAt
            }).catch(error => {
              console.error(`🧠 [RAG] Erreur embedding page "${page.title}":`, error);
            });
          }
        });

        console.log(`🧠 [RAG] Embedding déclenché pour ${selectedPages.length} pages sélectionnées`);
      } catch (error) {
        console.error('🧠 [RAG] Service non disponible:', error);
      }
    }

    const [ctx, webWithRefs] = await Promise.all([
      buildPagesContextChunked(workspaceId, selectedIds2, 10, sanitizedQuery, 12),
      useWeb ? tavilySearchRefs(sanitizedQuery) : Promise.resolve({ text: '', refs: [] })
    ]);
    const web = webWithRefs.text;
    console.log('[AssistantSearchStream] workspaceId=', workspaceId, 'pageIds=', pageIds, 'ctx.len=', ctx.length, 'useWeb=', useWeb, 'web.len=', web.length, 'web.refs=', (webWithRefs.refs || []).length);

    // 🏗️ STRUCTURE: Construction du prompt optimisé avec RAG + Web dans context
    const contextWithWeb = [ctx, web].filter(Boolean).join('\n\n');
    const optimizedPrompt = buildOptimizedPrompt('search', sanitizedQuery, contextWithWeb, '', analysis);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    const steps: string[] = [
      'Analyse la requête et le contexte',
      'Recherche des passages pertinents dans tes pages',
      useWeb ? 'Explore des sources web fiables' : 'Se limite aux pages du workspace',
      'Sélectionne les éléments clés',
      'Rédige une réponse claire et structurée'
    ];
    try {
      for (const s of steps) {
        res.write(`event: status\n`);
        res.write(`data: ${s}\n\n`);
        if ((res as any).flush) {
          (res as any).flush();
        }
        await new Promise(r => setTimeout(r, 250));
      }
    } catch {}

    let full = '';
    console.log('[AssistantSearchStream] start streaming to client');
    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: optimizedPrompt.systemMessage,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = formatAIStreamChunk(chunk);
        full += normalized;
        sseWriteData(res, normalized);
      }
    });
    console.log('[AssistantSearchStream] stream completed, full.len=', full.length);
    
    // Extraire les références Wikipedia du sanitizedQuery
    const wikipediaRefs: { title: string }[] = [];
    const wikipediaMatches = sanitizedQuery.match(/\*\*(.*?)\*\* \(Wikipedia\)/g);
    if (wikipediaMatches) {
      wikipediaRefs.push(...wikipediaMatches.map(match => ({
        title: match.replace(/\*\*(.*?)\*\* \(Wikipedia\)/, '$1')
      })));
    }
    
    const refPages2 = await prisma.page.findMany({ where: { id: { in: selectedIds2 } }, select: { id:true, title:true } });
    const pageRefs = refPages2.map(p => ({ title: p.title }));
    const webRefs = webWithRefs.refs || [];
    const refsBlock = formatItalicReferences([...pageRefs, ...webRefs, ...wikipediaRefs]);
    if (refsBlock) {
      sseWriteData(res, refsBlock);
      console.log('[AssistantSearchStream] sent references block len=', refsBlock.length);
    }
    res.write('event: done\n\n');
    console.log('[AssistantSearchStream] done event sent');
    res.end();
  } catch (e) {
    console.error('assistantSearchStream error', e);
    try { res.write(`event: error\ndata: ${(e as any)?.message || 'Erreur'}\n\n`); } catch {}
    res.end();
  }
};