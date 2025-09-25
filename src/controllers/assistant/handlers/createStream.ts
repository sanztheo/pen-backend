import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { GeminiService } from '../../../services/ai/gemini.js';
import { tavilySearch } from '../helpers/web.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { sseWriteData } from '../helpers/sse.js';
import { toBlockNoteAuto, sanitizeAIGeneratedContent } from '../helpers/blocknote.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { sanitizeUserInput, analyzeQuery, buildOptimizedPrompt } from '../helpers/promptOptimizer.js';

// Normalisation Markdown pour garantir la conversion fiable des titres (#, ##, ###)
function normalizeMarkdownForHeadings(input: string): string {
  let s = (input || '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line) || /^~~~/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    let l = line;
    l = l.replace(/^\s*(#{1,6})(\s*)/, (m, hashes, space) => `${hashes}${space}`);
    l = l.replace(/^#{4,}\s*/, '### ');
    l = l.replace(/^(#{1,3})([^\s#])/, '$1 $2');
    l = l.replace(/^(#{1,3}\s.*?)(\s*#+\s*)$/, '$1');
    lines[i] = l;
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3}\s/.test(l) && i > 0 && lines[i - 1].trim() !== '') {
      out.push('');
    }
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const assistantCreateStream = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { 
      instruction, 
      title, 
      workspaceId, 
      projectId, 
      reflection = 'rapide', 
      useWeb = true, 
      ragSources = [],
      ragContext = '' 
    } = req.body as {
      instruction: string; 
      title?: string; 
      workspaceId: string; 
      projectId?: string; 
      reflection?: 'rapide' | 'profond'; 
      useWeb?: boolean;
      ragSources?: Array<{ title: string; [key: string]: any }>;
      ragContext?: string;
    };
    if (!instruction || !workspaceId) return res.status(400).json({ error: 'instruction, workspaceId requis' });

    // 🔍 [WEB-DEBUG] Traçage du paramètre web depuis la requête (CREATE mode)
    console.log(`🌐 [WEB-DEBUG] [CREATE] Paramètre useWeb reçu: ${useWeb} (type: ${typeof useWeb}) - DEFAULT: true`);
    console.log(`🌐 [WEB-DEBUG] [CREATE] Corps de requête - useWeb:`, req.body?.useWeb);
    console.log(`🌐 [WEB-DEBUG] [CREATE] Tous les paramètres:`, JSON.stringify({
      hasInstruction: !!instruction,
      workspaceId: !!workspaceId,
      useWeb,
      ragSourcesCount: ragSources.length,
      reflection
    }));

    console.log(`🔥 [CREATE-STREAM] ENTRÉE - workspaceId: ${workspaceId}, ragSources.length: ${ragSources.length}, ragSources: ${ragSources.map(s => s.title).join(', ')}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedInstruction = sanitizeUserInput(instruction);
    
    // 🧠 INTELLIGENCE: Analyse de la requête
    const analysis = analyzeQuery(sanitizedInstruction, req);

    // 🔥 NOUVEAU: Construire le contexte à partir des sources RAG si disponibles
    let ragContextText = '';
    if (ragSources && ragSources.length > 0 && ragContext) {
      console.log('[AssistantCreateStream] Utilisation du contexte RAG avec', ragSources.length, 'sources');
      ragContextText = ragContext;
    } else if (ragSources && ragSources.length > 0) {
      // Pour les sources RAG externes (Wikipedia), ne pas chercher dans les pages workspace
      // Le contexte RAG est géré par le système RAG lui-même via l'API
      console.log('[AssistantCreateStream] Sources RAG externes détectées - contexte sera fourni par le système RAG');
      ragContextText = ''; // Le contexte viendra du système RAG automatiquement
    }

    // 🔍 [WEB-DEBUG] Déclenchement de la recherche web (CREATE mode)
    console.log(`🌐 [WEB-DEBUG] [CREATE] Avant recherche web - useWeb: ${useWeb}, instruction: "${sanitizedInstruction}"`);

    const web = useWeb ? await tavilySearch(sanitizedInstruction) : '';

    // 🔍 [WEB-DEBUG] Résultats de la recherche web (CREATE mode)
    console.log(`🌐 [WEB-DEBUG] [CREATE] Après recherche web - useWeb: ${useWeb}`);
    console.log(`🌐 [WEB-DEBUG] [CREATE] - Web text length: ${web.length}`);
    if (useWeb && web.length === 0) {
      console.log(`🌐 [WEB-DEBUG] [CREATE] ⚠️ ATTENTION: Web activé mais aucun contenu trouvé!`);
    }
    if (!useWeb && web.length > 0) {
      console.log(`🌐 [WEB-DEBUG] [CREATE] 🚨 ERREUR: Web désactivé mais contenu présent!`);
    }

    if (reflection === 'profond') {
      try {
        // 🏗️ STRUCTURE: Construction du prompt optimisé pour Gemini (avec thinking)
        const contextWithWeb = [ragContextText, web].filter(Boolean).join('\n\n');
        const optimizedPrompt = buildOptimizedPrompt('create', sanitizedInstruction, contextWithWeb, '', analysis);

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
        res.flushHeaders();

        let full = '';
        let thinkingContent = '';
        await GeminiService.generateWithThinking({
          prompt: optimizedPrompt.userMessage,
          context: optimizedPrompt.systemMessage,
          temperature: optimizedPrompt.temperature,
          maxTokens: optimizedPrompt.maxTokens,
          onStream: (chunk: string) => {
            const normalized = String(chunk || '');
            full += normalized;
            sseWriteData(res, normalized);
          },
          onThinking: (thinking: string) => {
            thinkingContent += thinking;
            res.write(`event: status\\n`);
            res.write(`data: 🤔 ${thinking}\\n\\n`);
            if ((res as any).flush) {
              (res as any).flush();
            }
          }
        });

        let finalTitle = (typeof title === 'string' ? title : '').trim();
        if (!finalTitle || finalTitle.toLowerCase() === 'nouvelle page') {
          try {
            const t = await AIService.generateContent({
              prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${sanitizedInstruction}. Réponds uniquement par le titre, sans guillemets.`,
              context: buildLangInstruction(detectPreferredLanguage(req)),
              temperature: 0.3,
              maxTokens: 40
            });
            finalTitle = (t.content || 'Nouvelle page').replace(/^\"|\"$/g, '').trim();
          } catch {
            finalTitle = 'Nouvelle page';
          }
        }

        const page = await prisma.page.create({
          data: {
            title: finalTitle,
            slug: finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 10000),
            projectId: projectId || null,
            workspaceId,
            createdBy: req.user!.id
          }
        });
        const blockNote = toBlockNoteAuto(
          normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full))
        );
        await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

        res.write(`event: page\\n`);
        res.write(`data: ${JSON.stringify({ pageId: page.id, title: page.title, thinking: thinkingContent })}\\n\\n`);
        res.write('event: done\\n\\n');
        res.end();
        return;
      } catch (error) {
        console.warn('⚠️ Gemini failed, fallback to OpenAI:', error);
      }
    }

    // 🏗️ STRUCTURE: Construction du prompt optimisé pour OpenAI standard
    const contextWithWeb = [ragContextText, web].filter(Boolean).join('\n\n');
    const optimizedPrompt = buildOptimizedPrompt('create', sanitizedInstruction, contextWithWeb, '', analysis);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    let full = '';
    await AIService.generateContent({
      prompt: optimizedPrompt.userMessage,
      context: optimizedPrompt.systemMessage,
      temperature: optimizedPrompt.temperature,
      maxTokens: optimizedPrompt.maxTokens,
      onStream: (chunk: string) => {
        const normalized = String(chunk || '');
        full += normalized;
        sseWriteData(res, normalized);
      }
    });

    let finalTitle = (typeof title === 'string' ? title : '').trim();
    if (!finalTitle || finalTitle.toLowerCase() === 'nouvelle page') {
      try {
        const t = await AIService.generateContent({
          prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${sanitizedInstruction}. Réponds uniquement par le titre, sans guillemets.`,
          context: buildLangInstruction(detectPreferredLanguage(req)),
          temperature: 0.3,
          maxTokens: 40
        });
        finalTitle = (t.content || 'Nouvelle page').replace(/^"|"$/g, '').trim();
      } catch {
        finalTitle = 'Nouvelle page';
      }
    }

    const page = await prisma.page.create({
      data: {
        title: finalTitle,
        slug: finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 10000),
        projectId: projectId || null,
        workspaceId,
        createdBy: req.user!.id
      }
    });
    const blockNote = toBlockNoteAuto(
      normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full))
    );
    await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

    res.write(`event: page\n`);
    res.write(`data: ${JSON.stringify({ pageId: page.id, title: page.title })}\n\n`);
    res.write('event: done\n\n');
    res.end();
  } catch (e) {
    console.error('assistantCreateStream error', e);
    try { res.write(`event: error\ndata: ${(e as any)?.message || 'Erreur'}\n\n`); } catch {}
    res.end();
  }
};