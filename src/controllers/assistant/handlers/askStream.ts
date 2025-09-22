import { Request, Response } from 'express';
import { AIService } from '../../../services/ai/index.js';
import { ConversationMemory } from '../../../services/ai/conversationMemory.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { isMathLatexIntent, LATEX_STRICT_RULES } from '../helpers/latex.js';
import { tavilySearch } from '../helpers/web.js';
import { buildPagesContextChunked } from '../helpers/context.js';
import { sseWriteData } from '../helpers/sse.js';
import { formatAIStreamChunk } from '../helpers/format.js';

export const assistantAskStream = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { query, workspaceId, pageIds = [], useWeb = false } = req.body as { query: string; workspaceId: string; pageIds?: string[]; useWeb?: boolean };
    if (!query) return res.status(400).json({ error: 'query requis' });

    console.log(`🔥 [ASK-STREAM] ENTRÉE - workspaceId: ${workspaceId}, pageIds: [${pageIds.join(', ')}], pageIds.length: ${pageIds.length}`);

    const lang = detectPreferredLanguage(req);
    
    // 🧠 RAG: Les pages sont maintenant embedées automatiquement à la sélection (frontend)

    const [ctx, web] = await Promise.all([
      workspaceId ? buildPagesContextChunked(workspaceId, pageIds, 8, query, 10) : Promise.resolve(''),
      useWeb ? tavilySearch(query) : Promise.resolve('')
    ]);
    const history = ConversationMemory.recentAsText(req.user.id, { maxChars: 1200, maxMessages: 8 });
    const mathMode = isMathLatexIntent(query);
    const mathGuidelines = `
MODE FORMULES LaTeX:
⚠️ UTILISE LATEX UNIQUEMENT pour les vraies formules mathématiques/scientifiques (équations, théorèmes, lois physiques).
❌ N'INVENTE PAS de formules pour des concepts philosophiques, politiques ou littéraires.
✅ Exemples valides: $E = mc^2$, $a^2 + b^2 = c^2$, $F = ma$
❌ Exemples interdits: $\\text{âme} = \\text{harmonie}$, $\\text{justice} = \\text{réciprocité}$
- Format: $$ FORMULE_MATHEMATIQUE_REELLE $$ — explication en français.
- N'ajoute aucun \\section/\\subsection ni environnement; pas de texte accentué dans $$ ... $$.
${LATEX_STRICT_RULES}`;
    const prompt = `Tu es un assistant IA expert et professionnel. Tu dois TOUJOURS répondre directement aux questions posées sans demander de clarifications supplémentaires.

RÈGLES COMPORTEMENTALES STRICTES:
- RÉPONDS DIRECTEMENT: N'évite jamais une question, ne demande jamais de précisions. Utilise le contexte disponible pour donner la meilleure réponse possible.
- SOIS INFORMATIF: Fournis des informations complètes et utiles basées sur tes connaissances et le contexte fourni.
- ÉVITE LES QUESTIONS: N'écris JAMAIS "Pourriez-vous préciser...", "Quel aspect vous intéresse...", ou toute autre question de clarification.
- STYLE DIRECT: Va droit au but, sois précis et factuel.

RÈGLES TECHNIQUES:
- FORMATAGE: Utilise des retours à la ligne naturels pour séparer les paragraphes. Écris des paragraphes distincts pour chaque idée principale.
- LATEX: Toute formule mathématique DOIT être correctement fermée ($...$ pour inline, $$...$$ pour display). VÉRIFIER l'équilibrage des délimiteurs.
- MARKDOWN: Utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4) ou plus profonds.
- FERMETURE: Chaque accolade {, crochet [, parenthèse ( doit avoir sa fermeture correspondante.
${mathMode ? mathGuidelines : ''}

Question de l'utilisateur: ${query}

Instructions: Réponds immédiatement et directement à cette question avec les informations disponibles. Ne pose aucune question de retour.`;
    // Détection intelligente du type de réponse nécessaire
    const isSimpleGreeting = /^(salut|bonjour|hello|hi|ça va|ok|merci)$/i.test(query.trim());
    const isComplexQuestion = /résumé|explique|analyse|compare|développe|décris|détaille/i.test(query);
    
    let responseGuideline = '';
    if (isSimpleGreeting) {
      responseGuideline = 'Réponds brièvement (1-2 phrases) et demande une précision.';
    } else if (isComplexQuestion) {
      responseGuideline = 'Réponds de façon détaillée et structurée (200-500 mots). Utilise des paragraphes clairs.';
    } else {
      responseGuideline = 'Réponds de façon concise mais complète (100-300 mots).';
    }
    
    const context = `CONTEXTE ET SOURCES DISPONIBLES:
${ctx}
${web}

HISTORIQUE DE CONVERSATION:
${history}

INSTRUCTIONS DE RÉPONSE:
${buildLangInstruction(lang)} ${responseGuideline}

RAPPEL IMPORTANT: Utilise le contexte ci-dessus pour répondre de manière complète et directe. Si tu n'as pas toutes les informations, réponds avec ce que tu sais plutôt que de demander des clarifications.`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    let fullAnswer = '';
    await AIService.generateContent({
      prompt,
      context,
      temperature: 0.2,
      maxTokens: 5000,
      onStream: (chunk: string) => {
        const normalized = formatAIStreamChunk(chunk);
        fullAnswer += normalized;
        sseWriteData(res, normalized);
      }
    });
    try { 
      ConversationMemory.addMessage(req.user.id, 'user', query);
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
