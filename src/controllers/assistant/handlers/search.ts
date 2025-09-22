import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { selectRelevantPagesWithAssistant } from '../../../services/ai/assistants/selectPages.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { tavilySearchRefs } from '../helpers/web.js';
import { titleRelevanceScore } from '../helpers/scoring.js';
import { formatAIText, formatItalicReferences } from '../helpers/format.js';

export const assistantSearch = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { query, workspaceId, pageIds = [], useWeb = true } = req.body as { query: string; workspaceId: string; pageIds?: string[]; useWeb?: boolean };
    if (!query || !workspaceId) return res.status(400).json({ error: 'query et workspaceId requis' });

    const lang = detectPreferredLanguage(req);
    let selectedIds: string[] = pageIds;
    if (!selectedIds || selectedIds.length === 0 || (req.body as any)?.sourcesScope === 'all') {
      console.log('[AssistantSearch] selection step (all sources)');
      const all = await prisma.page.findMany({ where: { workspaceId, isArchived: false }, select: { id: true, title: true }, orderBy: { updatedAt: 'desc' }, take: 200 });
      const sel = await selectRelevantPagesWithAssistant({ question: query, pages: all.map(p => ({ id: p.id, title: p.title })), maxResults: 5 });
      const initialSelected = (sel.selected || []);
      let pruned = initialSelected
        .map(p => ({ ...p, score: titleRelevanceScore(p.title, query) }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => p.id);
      console.log('[AssistantSearch] IA selection (raw)=', initialSelected.map(p => p.title));
      console.log('[AssistantSearch] IA selection pruned (ids.len)=', pruned.length);
      selectedIds = pruned;

      if (!selectedIds.length || selectedIds.length === all.length) {
        console.log('[AssistantSearch] AI selection failed, using smart fallback');
        const score = (title: string) => {
          const queryWords = (query || '').toLowerCase()
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
        selectedIds = scored.slice(0, Math.min(5, scored.length)).map(p => p.id);
        console.log('[AssistantSearch] fallback selection:', scored.slice(0,5).map(p => `${p.title} (${p.score})`));
        if (!selectedIds.length) {
          selectedIds = all.slice(0, 3).map(p => p.id);
          console.log('[AssistantSearch] final fallback: recent pages');
        }
      }
      console.log('[AssistantSearch] selectedIds.len=', selectedIds.length);
    }

    const [ctx, webWithRefs] = await Promise.all([
      buildPagesContextChunked(workspaceId, selectedIds, 10, query, 12),
      useWeb ? tavilySearchRefs(query) : Promise.resolve({ text: '', refs: [] })
    ]);
    console.log('[AssistantSearch] workspaceId=', workspaceId, 'pageIds=', pageIds, 'ctx.len=', ctx.length, 'useWeb=', useWeb, 'web.len=', (webWithRefs.text || '').length, 'web.refs=', (webWithRefs.refs || []).length);

    const web = webWithRefs.text;
    const mathMode = isMathLatexIntent(query);
    const baseGuidelines = `
Consignes:
${buildLangInstruction(lang)}
- Respecte l'intention de la question.
- Si elle vise une information précise (extraction/localisation), réponds UNIQUEMENT avec cette information sur une ligne, sans synthèse.
- Sinon, fournis une synthèse structurée et naturelle avec des paragraphes courts.
- FORMATAGE: utilise \\n pour les retours à la ligne et sépare les paragraphes par \\n\\n.
- Termine par une section "Références" listant 3–5 sources (Titre — URL).
- Si des pages du workspace sont fournies, privilégie leur contenu.`;

    const mathGuidelines = `
MODE FORMULES LaTeX:
- Liste 8 à 15 formules maximum.
- Chaque ligne: $$ FORMULE $$ — explication courte en français (hors des $$ ... $$).
- N'ajoute aucun \section/\subsection ni environnement; pas de texte accentué dans $$ ... $$.
${LATEX_STRICT_RULES}`;

    const context = `${ctx}

${web}

${baseGuidelines}
${mathMode ? mathGuidelines : ''}`;

    const MAX_TOKENS_SEARCH = 30000;
    console.log('[AssistantSearch] calling AIService.generateContent maxTokens=', MAX_TOKENS_SEARCH);
    const result = await AIService.generateContent({ prompt: query, context, temperature: 0.3, maxTokens: MAX_TOKENS_SEARCH });
    const refPages = await prisma.page.findMany({ where: { id: { in: selectedIds } }, select: { id:true, title:true } });
    const pageRefs = refPages.map(p => ({ title: p.title }));
    const webRefs = webWithRefs.refs || [];
    const refsBlock = formatItalicReferences([...pageRefs, ...webRefs]);
    const answer = formatAIText(result.content || '');
    console.log('[AssistantSearch] result.len=', answer.length, 'refs.len=', refsBlock.length);
    res.json({ answer, references: refsBlock, model: result.model, usedWeb: !!web });
  } catch (e) {
    console.error('assistantSearch error', e);
    const message = (e as any)?.message || 'Erreur assistant recherche';
    res.status(500).json({ error: message });
  }
};