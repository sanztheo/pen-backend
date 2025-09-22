export async function tavilySearch(query: string): Promise<string> {
  try {
    if (!process.env.TAVILY_API_KEY) return '';
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, search_depth: 'advanced', max_results: 5 })
    });
    if (!resp.ok) return '';
    const data: any = await resp.json();
    if (!data || !data.results) return '';
    const items = data.results.map((r: any, i: number) => `(${i + 1}) ${r.title} — ${r.url}\n${r.content?.slice(0, 500) || ''}`);
    return items.length ? `Sources web:\n\n${items.join('\n\n')}` : '';
  } catch {
    return '';
  }
}

export async function tavilySearchRefs(query: string): Promise<{ text: string; refs: { title: string; url?: string }[] }>{
  try {
    if (!process.env.TAVILY_API_KEY) return { text: '', refs: [] };
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, search_depth: 'advanced', max_results: 5 })
    });
    if (!resp.ok) return { text: '', refs: [] };
    const data: any = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const refs = results.map((r: any) => ({ title: String(r?.title || '').trim(), url: String(r?.url || '').trim() })).filter((r: any) => r.title);
    const items = results.map((r: any, i: number) => `(${i + 1}) ${r.title} — ${r.url}\n${(r?.content || '').slice(0, 500)}`);
    const text = items.length ? `Sources web:\n\n${items.join('\n\n')}` : '';
    return { text, refs };
  } catch {
    return { text: '', refs: [] };
  }
}