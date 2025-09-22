export const GENERIC_TITLE_PATTERNS = [
  /^nouvelle page$/i,
  /^untitled$/i,
  /^sans titre$/i,
  /^draft$/i,
  /^test+$/i,
  /^notes?$/i,
  /^todo$/i
];

export function isGenericTitle(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return true;
  return GENERIC_TITLE_PATTERNS.some((re) => re.test(t));
}

export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/)
    .filter(Boolean);
}

export function filterQueryTokens(tokens: string[]): string[] {
  const stop = new Set([
    'parle','moi','de','la','le','les','des','du','un','une','et','en','au','aux','sur','dans','pour','que','quoi','qui','comment','pourquoi','est','cest','ce','mon','ma','mes','tes','ton','ta'
  ]);
  return tokens.filter((w) => !stop.has(w));
}

export function titleRelevanceScore(title: string, query: string): number {
  const titleLower = String(title || '').toLowerCase();
  const titleTokens = new Set(tokenize(titleLower));
  const rawQueryTokens = tokenize(String(query || ''));
  const queryTokens = filterQueryTokens(rawQueryTokens);

  if (!queryTokens.length) return 0;

  let score = 0;
  for (const word of queryTokens) {
    if (word.length <= 2) {
      if (titleTokens.has(word)) {
        score += 4;
      }
      continue;
    }
    if (titleLower.includes(word)) {
      score += word.length * 2;
    }
    let partial = 0;
    for (const ch of word) {
      if (titleLower.includes(ch)) partial++;
    }
    score += (partial / word.length) * 0.3;
  }

  if (isGenericTitle(title)) {
    score -= 3;
  }

  return score;
}

export function keywordScore(text: string, query: string): number {
  const words = (query || '').toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿñæœ0-9]+/i).filter(w => w.length >= 3);
  const t = text.toLowerCase();
  return words.reduce((acc, w) => acc + (t.split(w).length - 1), 0);
}