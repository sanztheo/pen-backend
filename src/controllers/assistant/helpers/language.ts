import type { Request } from 'express';

export function detectPreferredLanguage(req: Request): { code: string; name: string } {
  const raw = (req.headers['x-user-lang'] as string) || (req.headers['accept-language'] as string) || 'fr';
  const first = raw.split(',')[0]?.trim() || 'fr';
  const code = first.split('-')[0]?.toLowerCase() || 'fr';
  const map: Record<string, string> = {
    fr: 'French',
    en: 'English',
    es: 'Spanish',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ar: 'Arabic',
    zh: 'Chinese',
    ja: 'Japanese',
    ru: 'Russian'
  };
  const name = map[code] || 'French';
  return { code, name };
}

export function buildLangInstruction(lang: { code: string; name: string }): string {
  if (lang.code === 'fr') return 'Réponds en français.';
  return `Answer in ${lang.name}.`;
}