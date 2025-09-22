import OpenAI from 'openai';
import { AIService } from '../base.js';

type PageLite = { id: string; title: string };

export async function selectRelevantPagesWithAssistant(params: {
  question: string;
  pages: PageLite[];
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<{ selected: PageLite[] }> {
  const assistantId = AIService.getSearchAssistantId();
  if (!assistantId) {
    console.warn('ASSISTANT_ID_SEARCH_FILE manquant; fallback = 0 sélection');
    return { selected: [] };
  }
  const client = AIService.getOpenAI();

  console.log('[SelectPages] start', {
    assistantId,
    pagesCount: params.pages?.length || 0,
    maxResults: params.maxResults ?? 10,
    question: params.question,
    pages: params.pages?.map(p => p.title) || []
  });

  // Le function schema vient de command2.md (name: select_pages)
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'select_pages',
        description: "Retourne UNIQUEMENT les IDs des pages pertinentes, dans l'ordre de pertinence.",
        parameters: {
          type: 'object',
          properties: {
            selected_ids: {
              type: 'array',
              description: 'Liste ordonnée des IDs des pages sélectionnées (0 à 5 max).',
              items: { type: 'string' },
              minItems: 0,
              uniqueItems: true,
              maxItems: 5
            }
          },
          required: ['selected_ids'],
          additionalProperties: false
        }
      }
    }
  ];

  const system = `Tu es un assistant de sélection expert. Tu reçois une question et une liste de pages (titre + id).

MISSION : Sélectionner UNIQUEMENT les pages directement liées au sujet de la question.

RÈGLES STRICTES :
- Analyse le sujet principal de la question
- Sélectionne SEULEMENT les pages dont le titre correspond clairement au sujet
- REJETTE impitoyablement les pages hors-sujet
- Si aucune page n'est pertinente, renvoie une liste vide
- Maximum 5 pages, même si beaucoup semblent pertinentes

FORMAT DE SORTIE OBLIGATOIRE :
- Appelle exclusivement la fonction select_pages avec l'argument selected_ids (array de strings)
- selected_ids doit contenir UNIQUEMENT des IDs présents dans la liste des pages fournie
- N'invente JAMAIS d'ID

EXEMPLES :
Question: "Parle moi de l'IA" → Sélectionne: ["Intelligence Artificielle", "IA et Machine Learning"] → Rejette: ["Guerre Mondiale", "Histoire de France"]
Question: "Guerre mondiale" → Sélectionne: ["1ère Guerre Mondiale", "2nde Guerre Mondiale"] → Rejette: ["IA", "Technologie"]
Question: "Comment cuisiner" → Sélectionne: ["Recettes", "Cuisine française"] → Rejette: ["Mathématiques", "Programmation"]

Ne renvoie AUCUN texte libre. Aucun discours. Seulement l'appel de fonction select_pages.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: JSON.stringify({ question: params.question, pages: params.pages, max_results: params.maxResults ?? 10 })
    }
  ];

  const resp = await client.chat.completions.create({
    model: AIService.getDefaultModel()!,
    messages,
    tools,
    tool_choice: { type: 'function', function: { name: 'select_pages' } },
    temperature: 0,
    max_tokens: 500,
    stream: false,
    ...(params.signal ? { signal: params.signal } : {})
  }) as any;

  const toolCalls = resp.choices?.[0]?.message?.tool_calls || [];
  const call = toolCalls.find((c: any) => c?.function?.name === 'select_pages');
  if (!call) return { selected: [] };
  try {
    const args = JSON.parse(call.function.arguments || '{}');
    const max = params.maxResults ?? 10;
    const providedPages = Array.isArray(params.pages) ? params.pages : [];
    const byId = new Map<string, PageLite>();
    for (const p of providedPages) byId.set(String(p.id), { id: String(p.id), title: String(p.title) });

    const selectedIdsRaw = Array.isArray(args?.selected_ids) ? args.selected_ids : [];
    const seen = new Set<string>();
    const selected: PageLite[] = [];
    for (const raw of selectedIdsRaw) {
      const id = String(raw);
      if (seen.has(id)) continue;
      const page = byId.get(id);
      if (page) {
        selected.push(page);
        seen.add(id);
      }
      if (selected.length >= Math.min(5, max)) break;
    }

    console.log('[SelectPages] done', {
      returned: selected.length,
      selectedTitles: selected.map(p => p.title)
    });
    return { selected };
  } catch {
    console.warn('[SelectPages] parse error on tool arguments');
    return { selected: [] };
  }
}

