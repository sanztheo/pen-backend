import type { Request } from 'express';
import { prisma } from '../../../lib/prisma.js';

export type Personalization = {
  classe?: string;
  etude?: string;
  filiere?: string;
  langue?: string;
  presentation?: string;
};

const clean = (v: unknown, max = 700) => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
};

function parseFromHeader(req: Request): Personalization | null {
  const raw = (req.headers['x-user-personalization'] as string) || '';
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    const p: Personalization = {};
    if (obj.classe !== undefined) p.classe = clean(obj.classe, 120);
    if (obj.etude !== undefined) p.etude = clean(obj.etude, 120);
    if (obj.filiere !== undefined) p.filiere = clean(obj.filiere, 120);
    if (obj.langue !== undefined) p.langue = clean(obj.langue, 10);
    if (obj.presentation !== undefined) p.presentation = clean(obj.presentation, 700);
    return p;
  } catch {
    return null;
  }
}

function parseFromBody(req: Request): Personalization | null {
  const obj = (req.body as any)?.personalization;
  if (!obj || typeof obj !== 'object') return null;
  const p: Personalization = {};
  if (obj.classe !== undefined) p.classe = clean(obj.classe, 120);
  if (obj.etude !== undefined) p.etude = clean(obj.etude, 120);
  if (obj.filiere !== undefined) p.filiere = clean(obj.filiere, 120);
  if (obj.langue !== undefined) p.langue = clean(obj.langue, 10);
  if (obj.presentation !== undefined) p.presentation = clean(obj.presentation, 700);
  return Object.keys(p).length ? p : null;
}

export async function readPersonalizationFromReq(req: Request): Promise<Personalization | null> {
  // 1) Headers en priorité (pas de hit DB sur chaque appel si déjà fourni)
  const fromHeader = parseFromHeader(req);
  if (fromHeader && Object.keys(fromHeader).length > 0) return fromHeader;

  // 2) Corps de requête (si fourni)
  const fromBody = parseFromBody(req);
  if (fromBody && Object.keys(fromBody).length > 0) return fromBody;

  // 3) Fallback DB (si user est authentifié)
  try {
    if (!req.user?.id) return null;
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { settings: true } });
    const p = (user?.settings as any)?.personalization as Personalization | undefined;
    if (!p) return null;
    return {
      classe: clean(p.classe, 120),
      etude: clean(p.etude, 120),
      filiere: clean(p.filiere, 120),
      langue: clean(p.langue, 10),
      presentation: clean(p.presentation, 700)
    };
  } catch {
    return null;
  }
}

export function buildPersonaSnippet(p: Personalization | null | undefined, maxPresentation = 400): string {
  if (!p) return '';
  const parts: string[] = [];
  const kv: string[] = [];
  if (p.classe) kv.push(`classe=${p.classe}`);
  if (p.etude) kv.push(`etude=${p.etude}`);
  if (p.filiere) kv.push(`filiere=${p.filiere}`);
  if (kv.length > 0) parts.push(`Profil utilisateur: ${kv.join('; ')}`);
  if (p.presentation) {
    const pres = p.presentation.length > maxPresentation ? p.presentation.slice(0, maxPresentation) + '…' : p.presentation;
    parts.push(`Présentation: « ${pres} »`);
  }
  return parts.join('\n');
}

export function buildPersonaXML(p: Personalization | null | undefined): string {
  if (!p) return '';
  const rows: string[] = [];
  if (p.classe) rows.push(`classe: ${p.classe}`);
  if (p.etude) rows.push(`etude: ${p.etude}`);
  if (p.filiere) rows.push(`filiere: ${p.filiere}`);
  if (p.presentation) rows.push(`presentation: ${p.presentation}`);
  if (rows.length === 0) return '';
  return `<user_profile priority="high">\n${rows.join('\n')}\n</user_profile>`;
}
