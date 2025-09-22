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

    console.log(`🔥 [CREATE-STREAM] ENTRÉE - workspaceId: ${workspaceId}, ragSources.length: ${ragSources.length}, ragSources: ${ragSources.map(s => s.title).join(', ')}`);

    // 🔥 NOUVEAU: Construire le contexte à partir des sources RAG si disponibles
    let ragContextText = '';
    if (ragSources && ragSources.length > 0 && ragContext) {
      console.log('[AssistantCreateStream] Utilisation du contexte RAG avec', ragSources.length, 'sources');
      ragContextText = ragContext;
    } else if (ragSources && ragSources.length > 0) {
      // Fallback: construire le contexte à partir des pages si pas de ragContext pré-construit
      console.log('[AssistantCreateStream] Construction du contexte à partir des sources RAG');
      const ragTitles = ragSources.map(s => s.title);
      const ragPages = await prisma.page.findMany({
        where: { 
          workspaceId, 
          isArchived: false,
          title: { in: ragTitles }
        },
        select: { id: true, title: true }
      });
      
      if (ragPages.length > 0) {
        const pageIds = ragPages.map(p => p.id);
        
        // 🧠 RAG: Les pages sont maintenant embedées automatiquement à la sélection (frontend)
        
        ragContextText = await buildPagesContextChunked(workspaceId, pageIds, 10, instruction, 12);
        console.log('[AssistantCreateStream] Contexte RAG construit:', ragContextText.length, 'caractères');
      }
    }

    const web = useWeb ? await tavilySearch(instruction) : '';
    const style = reflection === 'profond' ? 'Développe en détail avec une structure claire.' : 'Rédige de façon concise et claire.';

    if (reflection === 'profond') {
      try {
        const lang = detectPreferredLanguage(req);
        const mathMode = isMathLatexIntent(instruction);
        const mathGuidelines = `
MODE FORMULES LaTeX:
⚠️ UTILISE LATEX UNIQUEMENT pour les vraies formules mathématiques/scientifiques (équations, théorèmes, lois physiques).
❌ N'INVENTE PAS de formules pour des concepts philosophiques, politiques ou littéraires.
✅ Exemples valides: $E = mc^2$, $a^2 + b^2 = c^2$, $F = ma$
❌ Exemples interdits: $\\text{âme} = \\text{harmonie}$, $\\text{justice} = \\text{réciprocité}$
- Format: $$ FORMULE_MATHEMATIQUE_REELLE $$ — explication en français.
- N'ajoute aucun \\section/\\subsection ni environnement; pas de texte accentué dans $$ ... $$.
${LATEX_STRICT_RULES}`;
        const geminiContext = `${ragContextText}

${web}
        Tu crées le contenu d'une page pour une application de prise de notes.
        ${buildLangInstruction(lang)}
        ${style}
        Règles de cohérence:
        - Priorise le contexte fourni (notamment le contexte des sources sélectionnées); n'invente pas de faits.
        - Structure claire: titres (##), sous-titres (###), paragraphes courts.
        - MARKDOWN STRICT: utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4), ##### (h5) ou plus profonds.
        - FORMATTING: utilise \\n pour les retours à la ligne; sépare les paragraphes par \\n\\n.
        - Évite les blocs compacts; privilégie lisibilité et exemples concrets.
        - Si formules, utilise $...$ ou $$...$$ et respecte les règles LaTeX strictes.
        - NE PAS générer automatiquement de sections "Mini-FAQ", "Checklist" ou "Questions fréquentes" sauf si explicitement demandé.
        ${mathMode ? mathGuidelines : LATEX_STRICT_RULES}
        Réponds uniquement avec le texte final, sans en-tête, sans balises, sans métadonnées.`;

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
          prompt: `${style}\\n\\nSujet: ${instruction}`,
          context: geminiContext,
          temperature: 0.4,
          maxTokens: 20000,
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
              prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${instruction}. Réponds uniquement par le titre, sans guillemets.`,
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

    const mathMode = isMathLatexIntent(instruction);
    const mathGuidelines = `
MODE FORMULES LaTeX:
⚠️ UTILISE LATEX UNIQUEMENT pour les vraies formules mathématiques/scientifiques (équations, théorèmes, lois physiques).
❌ N'INVENTE PAS de formules pour des concepts philosophiques, politiques ou littéraires.
✅ Exemples valides: $E = mc^2$, $a^2 + b^2 = c^2$, $F = ma$
❌ Exemples interdits: $\\text{âme} = \\text{harmonie}$, $\\text{justice} = \\text{réciprocité}$
- Format: $$ FORMULE_MATHEMATIQUE_REELLE $$ — explication en français.
- N'ajoute aucun \\section/\\subsection ni environnement; pas de texte accentué dans $$ ... $$.
${LATEX_STRICT_RULES}`;
    const context = `${ragContextText}

${web}
    Tu crées le contenu d'une page pour une application de prise de notes.
    ${buildLangInstruction(detectPreferredLanguage(req))}
    Règles de cohérence:
    - Priorise le contexte fourni (notamment le contexte des sources sélectionnées); n'invente pas de faits.
    - Structure claire: titres (##), sous-titres (###), paragraphes courts.
    - MARKDOWN STRICT: utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4), ##### (h5) ou plus profonds.
    - FORMATTING: utilise \\n pour les retours à la ligne; sépare les paragraphes par \\n\\n.
    - Évite les blocs compacts; privilégie lisibilité et exemples concrets.
    - Si formules, utilise $...$ ou $$...$$ et respecte les règles LaTeX strictes.
    - NE PAS générer automatiquement de sections "Mini-FAQ", "Checklist" ou "Questions fréquentes" sauf si explicitement demandé.
    ${mathMode ? mathGuidelines : LATEX_STRICT_RULES}
    Réponds uniquement avec le texte final, sans en-tête, sans balises, sans métadonnées.`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    let full = '';
    await AIService.generateContent({
      prompt: `${style}\n\nSujet: ${instruction}`,
      context,
      temperature: 0.4,
      maxTokens: 30000,
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
          prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${instruction}. Réponds uniquement par le titre, sans guillemets.`,
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