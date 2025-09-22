import { Request, Response } from 'express';
import { AIService } from '../../../services/ai/index.js';
import { ConversationMemory } from '../../../services/ai/conversationMemory.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { tavilySearchRefs } from '../helpers/web.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { formatAIText } from '../helpers/format.js';

export const assistantAsk = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { query, workspaceId, pageIds = [] } = req.body as { query: string; workspaceId: string; pageIds?: string[] };
    if (!query || !workspaceId) return res.status(400).json({ error: 'query et workspaceId requis' });

    const lang = detectPreferredLanguage(req);
    const [ctx, webWithRefs] = await Promise.all([
      buildPagesContextChunked(workspaceId, pageIds, 8, query, 10),
      tavilySearchRefs(query)
    ]);
    const web = webWithRefs.text;
    const history = ConversationMemory.recentAsText(req.user.id, { maxChars: 1600, maxMessages: 10 });
    console.log('[AssistantAsk] workspaceId=', workspaceId, 'pageIds=', pageIds, 'ctx.len=', ctx.length, 'web.len=', (web || '').length);

    const prompt = `Question: ${query}

RÈGLES STRICTES OBLIGATOIRES:
- LATEX: Toute formule mathématique DOIT être correctement fermée ($...$ pour inline, $$...$$ pour display). VÉRIFIER l'équilibrage des délimiteurs.
- MARKDOWN: Utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4) ou plus profonds.
- FERMETURE: Chaque accolade {, crochet [, parenthèse ( doit avoir sa fermeture correspondante.
Consigne de raisonnement: réfléchis étape par étape en interne (reformule la question en 1 phrase, élabore un plan en 2–3 points), puis réponds; NE RÉVÈLE PAS ton raisonnement.`;

    const context = `${ctx}

${web}

${buildLangInstruction(lang)}
Consignes:
- Priorise le contexte fourni (workspace + web). En cas de conflit, privilégie le contexte.
- Si la question vise une information précise, réponds UNIQUEMENT avec cette information en 2–6 phrases claires.
- Sinon, réponds en 3–6 phrases naturelles (≈80–150 mots), sans liste ni titres.
- N'invente pas de références; ne cite pas si non nécessaires.
${history ? `\n\n${history}` : ''}`;
    const result = await AIService.generateContent({ prompt, context, temperature: 0.2, maxTokens: 2000 });
    const answer = formatAIText(result.content);
    const compact = answer.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    try {
      ConversationMemory.addMessage(req.user.id, 'user', query);
      ConversationMemory.addMessage(req.user.id, 'assistant', compact);
    } catch {}
    res.json({ answer: compact, model: result.model });
  } catch (e) {
    console.error('assistantAsk error', e);
    const message = (e as any)?.message || 'Erreur assistant';
    res.status(500).json({ error: message });
  }
};