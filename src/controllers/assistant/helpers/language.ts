import type { Request } from 'express';

export function detectPreferredLanguage(req: Request): { code: string; name: string } {
  // 1) Tenter de lire langue depuis la personnalisation envoyée en header
  let personaLang: string | null = null;
  const rawPersona = (req.headers['x-user-personalization'] as string) || '';
  if (rawPersona) {
    try {
      const p = JSON.parse(rawPersona);
      if (typeof p?.langue === 'string' && p.langue.trim()) {
        personaLang = String(p.langue).trim();
      }
    } catch {}
  }

  // 2) Tenter le body.personalization.langue si non défini en header
  if (!personaLang) {
    try {
      const bodyLang = (req.body as any)?.personalization?.langue;
      if (typeof bodyLang === 'string' && bodyLang.trim()) personaLang = String(bodyLang).trim();
    } catch {}
  }

  const raw = personaLang || (req.headers['x-user-lang'] as string) || (req.headers['accept-language'] as string) || 'fr';
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
