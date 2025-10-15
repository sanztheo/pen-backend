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
import { sanitizeUserInput, analyzeQuery, optimizePrompt } from '../helpers/promptOptimizer.js';

// 🚀 NOUVEAUX SERVICES (refactoring architecture)
import { DebugLogger } from '../config/debug.js';
import { ValidationUtils } from '../utils/validation.js';
import { AssistantHandlerService } from '../services/HandlerService.js';

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

    // 🚀 Parsing spécialisé pour CREATE (instruction au lieu de query)
    const {
      instruction,
      title,
      workspaceId,
      projectId,
      reflection = 'rapide',
      useWeb = true,
      ragSources = [],
      ragContext = ''
    } = req.body;

    if (!instruction || !workspaceId) {
      return res.status(400).json({ error: 'instruction, workspaceId requis' });
    }

    // 🔍 Debug unifié avec le nouveau système
    DebugLogger.web(`[CREATE] useWeb reçu: ${useWeb} (type: ${typeof useWeb}) - DEFAULT: true`);
    DebugLogger.rag(`[CREATE] ENTRÉE - workspaceId: ${workspaceId}, ragSources: ${ragSources.length}, reflection: ${reflection}`);

    // 🛡️ SÉCURITÉ: Nettoyage de l'input utilisateur
    const sanitizedInstruction = sanitizeUserInput(instruction);
    
    // 🧠 INTELLIGENCE: Analyse de la requête
    const analysis = analyzeQuery(sanitizedInstruction, req);

    // 🚀 Construction contexte avec les services unifiés
    let ragContextText = '';
    if (ragSources && ragSources.length > 0 && ragContext) {
      DebugLogger.rag(`[CREATE] Utilisation contexte RAG avec ${ragSources.length} sources`);
      ragContextText = ragContext;
    } else if (ragSources && ragSources.length > 0) {
      DebugLogger.rag(`[CREATE] Sources RAG externes détectées - contexte fourni par système RAG`);
      ragContextText = ''; // Le contexte viendra du système RAG automatiquement
    }

    // 🚀 Construction contexte web avec service unifié
    DebugLogger.web(`[CREATE] Déclenchement recherche web - useWeb: ${useWeb}`);

    const contextResult = await AssistantHandlerService.buildContextStrategy('create', {
      query: sanitizedInstruction,
      workspaceId,
      pageIds: [], // CREATE ne prend pas de pages spécifiques
      useWeb,
      ragSources,
      userId: req.user?.id || 'anonymous'
    });

    DebugLogger.web(`[CREATE] Contexte construit - web: ${contextResult.web.length}, rag: ${contextResult.ragContext?.length || 0}`);

    if (reflection === 'profond') {
      try {
        // 🎯 OPTIMISATION COMPLÈTE: Prompt avec troncature intelligente garantie pour Gemini
        // 🔥 INCLURE le contexte RAG du HandlerService si disponible
        const contextWithWeb = [ragContextText, contextResult.ragContext, contextResult.web].filter(Boolean).join('\n\n');
        const optimizedPrompt = optimizePrompt('create', sanitizedInstruction, contextWithWeb, '', req);

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
        res.write(`data: ${JSON.stringify({ pageId: page.id, title: page.title, projectId: page.projectId, thinking: thinkingContent })}\\n\\n`);
        res.write('event: done\\n\\n');
        res.end();
        return;
      } catch (error) {
        console.warn('⚠️ Gemini failed, fallback to OpenAI:', error);
      }
    }

    // 🎯 OPTIMISATION COMPLÈTE: Prompt avec troncature intelligente garantie pour OpenAI
    // 🔥 INCLURE le contexte RAG du HandlerService si disponible
    const contextWithWeb = [ragContextText, contextResult.ragContext, contextResult.web].filter(Boolean).join('\n\n');
    const optimizedPrompt = optimizePrompt('create', sanitizedInstruction, contextWithWeb, '', req);

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