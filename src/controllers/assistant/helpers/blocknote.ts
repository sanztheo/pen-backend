export function extractTextFromBlockNote(blocks: any[]): string {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((c: any) => {
        if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      });
    }
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  };
  walk(blocks);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse inline content with markdown formatting support
 * Converts **bold**, *italic*, __underline__, ~~strikethrough~~ to StyledText
 */
function parseInlineContent(text: string): any[] {
  const content: any[] = [];

  // 1) Extraire les inline LaTeX $...$
  const inlineLatexRe = /\$(.+?)\$/g;
  let match: RegExpExecArray | null;
  const segments: Array<{ type: 'plain' | 'latex'; text: string }> = [];
  let last = 0;
  while ((match = inlineLatexRe.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > last) segments.push({ type: 'plain', text: text.slice(last, start) });
    segments.push({ type: 'latex', text: match[1] || '' });
    last = end;
  }
  if (last < text.length) segments.push({ type: 'plain', text: text.slice(last) });

  // Helper: parser markdown léger sur un segment plain
  const pushStyled = (t: string) => {
    if (!t) return;
    const patterns = [
      { regex: /\*\*(.*?)\*\*/g, style: 'bold' },
      { regex: /\*(.*?)\*/g, style: 'italic' },
      { regex: /__(.*?)__/g, style: 'underline' },
      { regex: /~~(.*?)~~/g, style: 'strikethrough' }
    ];
    const matches: Array<{ start: number; end: number; text: string; style: string }> = [];
    patterns.forEach((p) => {
      let m: RegExpExecArray | null;
      while ((m = p.regex.exec(t)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[1], style: p.style });
      }
      p.regex.lastIndex = 0;
    });
    matches.sort((a, b) => a.start - b.start);
    let idx = 0;
    for (const m of matches) {
      if (m.start > idx) {
        const plain = t.slice(idx, m.start);
        if (plain) content.push({ type: 'text', text: plain });
      }
      const styles: any = {};
      styles[m.style] = true;
      content.push({ type: 'text', text: m.text, styles });
      idx = m.end;
    }
    if (idx < t.length) {
      const rest = t.slice(idx);
      if (rest) content.push({ type: 'text', text: rest });
    }
  };

  for (const s of segments) {
    if (s.type === 'plain') {
      pushStyled(s.text);
    } else {
      const latex = s.text.trim();
      if (latex) content.push({ type: 'inlineLatex', props: { latex: `$${latex}$` } });
    }
  }

  if (content.length === 0 && text) {
    content.push({ type: 'text', text });
  }
  return content;
}

/**
 * Check if a line contains LaTeX formula patterns
 */
function isLatexLine(line: string): { isLatex: boolean, latex?: string, isDisplay?: boolean } {
  // Check for display LaTeX ($$...$$)
  const displayMatch = line.match(/^\$\$(.*)\$\$$/);
  if (displayMatch) {
    let latex = displayMatch[1].trim();
    // Retirer un préfixe/suffixe de texte courant mal placé (ex: "Donc, ")
    latex = latex.replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '').replace(/\s*[—-].*$/,'');
    return { isLatex: true, latex, isDisplay: true };
  }

  // Check for inline LaTeX that occupies the whole line ($...$)
  const inlineMatch = line.match(/^\$(.*)\$$/);
  if (inlineMatch) {
    let latex = inlineMatch[1].trim();
    latex = latex.replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '').replace(/\s*[—-].*$/,'');
    return { isLatex: true, latex, isDisplay: false };
  }

  // Heuristique sûre: lignes math avec backslash + mot-clé LaTeX et accolades
  const mathKeywords = ['\\frac', '\\sum', '\\int', '\\sqrt', '\\lim', '\\alpha', '\\beta', '\\gamma', '\\pi', '\\theta', '\\lambda'];
  const containsKeyword = mathKeywords.some(keyword => line.includes(keyword));
  const hasBackslash = line.includes('\\');
  const hasBraces = line.includes('{') && line.includes('}');
  if (containsKeyword && hasBackslash && hasBraces) {
    return { isLatex: true, latex: line.trim(), isDisplay: false };
  }

  return { isLatex: false };
}

// Expressions typiques de narration IA à ignorer
const META_LINE_RE = /^(je\s+(vais|dois|suis|commence|utilise|vais\s+générer|vais\s+vérifier|vais\s+structurer|vais\s+utiliser|vais\s+m'assurer)|j[’'](ai|irai|utilise|assure)|plan\s+détaillé|révision\s+des\s+règles|exemples?|attention|alternative|je\s+vais\s+maintenant|cela\s+(semble|ne\s+semble\s+pas))/i;

/**
 * Décompose une ligne qui mélange texte et formules $$...$$ en blocs BlockNote.
 * Exemple: "Donc, $$c^2=a^2+b^2$$ — où c ..." → [p("Donc,"), latex, p("— où c ...")]
 */
function splitMixedDisplayLatex(line: string): any[] | null {
  if (!line.includes('$$')) return null;
  const result: any[] = [];
  let rest = line;
  const displayRe = /\$\$([\s\S]+?)\$\$/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = displayRe.exec(line)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    const before = line.slice(lastIndex, start).trim();
    if (before) {
      result.push({ type: 'paragraph', content: parseInlineContent(before) });
    }
    let latex = m[1].trim();
    latex = latex.replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '').replace(/\s*[—-].*$/, '');
    result.push({ type: 'latex', props: { latex: `$$${latex}$$` } });
    lastIndex = end;
  }
  const after = line.slice(lastIndex).trim();
  if (after) {
    result.push({ type: 'paragraph', content: parseInlineContent(after) });
  }
  return result.length > 0 ? result : null;
}

/**
 * Enhanced BlockNote conversion with LaTeX and markdown support
 */
export function toBlockNote(content: string): any[] {
  if (!content || !content.trim()) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }];
  }

  const lines = content.split(/\r?\n/);
  const blocks: any[] = [];
  let inBracketDisplay = false;
  let bracketBuffer = '';
  
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    
    // Skip completely empty lines
    if (!line) continue;

    // Ignorer lignes de narration/meta IA omniprésentes
    if (META_LINE_RE.test(line)) continue;

    // Gestion des blocs display LaTeX avec délimiteurs \[ ... \]
    if (inBracketDisplay) {
      // Chercher fin du bloc
      if (/^\\\]\s*$/.test(line)) {
        const latex = bracketBuffer.trim()
          .replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '')
          .replace(/\s*[—-].*$/, '');
        blocks.push({ type: 'latex', props: { latex: `$$${latex}$$` } });
        inBracketDisplay = false;
        bracketBuffer = '';
        continue;
      }
      // Accumuler
      bracketBuffer += (bracketBuffer ? '\n' : '') + line;
      continue;
    }
    // Début d'un bloc \[ ...
    if (/^\\\[\s*$/.test(line)) {
      inBracketDisplay = true;
      bracketBuffer = '';
      continue;
    }
    // Cas \[ ... \] sur une seule ligne
    const oneLineBracket = line.match(/^\\\[(.+)\\\]$/);
    if (oneLineBracket) {
      const latex = oneLineBracket[1].trim()
        .replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '')
        .replace(/\s*[—-].*$/, '');
      blocks.push({ type: 'latex', props: { latex: `$$${latex}$$` } });
      continue;
    }

    // Conversion d'une ligne JSON (JSONL isolé) en bloc BlockNote
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.t === 'string') {
          const t = String(obj.t);
          const c = typeof obj.c === 'string' ? obj.c : '';
          const d = obj.d;
          if (t === 'h') {
            const level = (typeof d === 'number' ? d : 2);
            const safeLevel = level === 3 ? 3 : 2; // Forcer h2/h3
            blocks.push({ type: 'heading', content: parseInlineContent(c), props: { level: safeLevel } });
            continue;
          }
          if (t === 'lx') {
            let latex = String(c || '').trim();
            latex = latex.replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '').replace(/\s*[—-].*$/, '');
            const display = d === 1 || d === true || String(d).toLowerCase() === 'display';
            blocks.push({ type: 'latex', props: { latex: display ? `$$${latex}$$` : `$${latex}$` } });
            continue;
          }
          if (t === 'li') {
            const ordered = String(d || '').toLowerCase() === 'ol';
            const type = ordered ? 'numberedListItem' : 'bulletListItem';
            blocks.push({ type, content: parseInlineContent(c) });
            continue;
          }
          if (t === 'p') {
            blocks.push({ type: 'paragraph', content: parseInlineContent(c) });
            continue;
          }
        }
      } catch {}
    }

    // Priorité 1: lignes mixtes avec $$...$$ inclus → découpage en blocs
    const mixed = splitMixedDisplayLatex(line);
    if (mixed && mixed.length > 0) {
      blocks.push(...mixed);
      continue;
    }

    // Priorité 2: lignes LaTeX pures
    const latexCheck = isLatexLine(line);
    if (latexCheck.isLatex && latexCheck.latex) {
      blocks.push({
        type: 'latex',
        props: {
          latex: latexCheck.isDisplay ? `$$${latexCheck.latex}$$` : `$${latexCheck.latex}$`
        }
      });
      continue;
    }

    // Check for headings (## and ###)
    if (/^#{2,3}\s+/.test(line)) {
      const level = line.startsWith('###') ? 3 : 2;
      const text = line.replace(/^#{2,3}\s+/, '');
      blocks.push({ 
        type: 'heading', 
        content: parseInlineContent(text), 
        props: { level } 
      });
      continue;
    }

  // Check for bullet list items (mais ignorer $$...$$ et $...$)
  if (!/^\$\$/.test(line) && !/^\$/.test(line) && /^[-•*]\s+/.test(line)) {
      const text = line.replace(/^[-•*]\s+/, '');
      blocks.push({ 
        type: 'bulletListItem', 
        content: parseInlineContent(text)
      });
      continue;
    }

  // Check for numbered list items
  if (!/^\$\$/.test(line) && !/^\$/.test(line) && /^\d+\.\s+/.test(line)) {
      const text = line.replace(/^\d+\.\s+/, '');
      blocks.push({ 
        type: 'numberedListItem', 
        content: parseInlineContent(text)
      });
      continue;
    }

    // Regular paragraph with inline formatting
    const inlineContent = parseInlineContent(line);
    blocks.push({ 
      type: 'paragraph', 
      content: inlineContent.length > 0 ? inlineContent : [{ type: 'text', text: line }]
    });
  }

  // Ensure we always return at least one block
  if (blocks.length === 0) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: content.trim() }] }];
  }

  return blocks;
}

/**
 * Convertit un JSONL compact (une ligne = un bloc) en contenu BlockNote.
 * Format minimal attendu par bloc: {"t":"p"|"h"|"lx"|"li","c":"...","d":number|string}
 * - t: type (p=paragraph, h=heading, lx=latex, li=list item)
 * - c: contenu texte (pour lx: LaTeX SANS délimiteurs textuels parasites)
 * - d:
 *   - h: niveau (2 ou 3)
 *   - lx: 1 = display ($$...$$), 0 = inline ($...$)
 *   - li: 'ul' ou 'ol'
 */
export function toBlockNoteFromJSONL(jsonl: string): any[] {
  if (!jsonl || typeof jsonl !== 'string') {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }];
  }

  const blocks: any[] = [];

  const lines = jsonl.split(/\r?\n/).filter(l => l.trim().length > 0);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Ignorer les balises éventuelles (protection)
    if (line.startsWith('<thinking>') || line.startsWith('</thinking>')) continue;

    let obj: any = null;
    try {
      obj = JSON.parse(line);
    } catch {
      // Si une ligne n'est pas du JSON, fallback: traiter comme paragraphe simple
      blocks.push({ type: 'paragraph', content: parseInlineContent(line) });
      continue;
    }

    const t = String(obj.t || '').trim();
    const c = typeof obj.c === 'string' ? obj.c : '';
    const d = obj.d;

    if (!t) {
      blocks.push({ type: 'paragraph', content: parseInlineContent(c) });
      continue;
    }

    if (t === 'h') {
      const level = (typeof d === 'number' ? d : 2);
      const safeLevel = level === 3 ? 3 : 2;
      blocks.push({ type: 'heading', content: parseInlineContent(c), props: { level: safeLevel } });
      continue;
    }

    if (t === 'lx') {
      let latex = String(c || '').trim();
      // Nettoyage défensif: retirer préfixes français et suffixes après tiret long
      latex = latex.replace(/^\s*(Donc,|Alors,|Ainsi,)\s*/i, '').replace(/\s*[—-].*$/, '');
      const display = d === 1 || d === true || String(d).toLowerCase() === 'display';
      blocks.push({
        type: 'latex',
        props: { latex: display ? `$$${latex}$$` : `$${latex}$` }
      });
      continue;
    }

    if (t === 'li') {
      const ordered = String(d || '').toLowerCase() === 'ol';
      const type = ordered ? 'numberedListItem' : 'bulletListItem';
      blocks.push({ type, content: parseInlineContent(c) });
      continue;
    }

    if (t === 'p') {
      blocks.push({ type: 'paragraph', content: parseInlineContent(c) });
      continue;
    }

    // Types inconnus → paragraphe
    blocks.push({ type: 'paragraph', content: parseInlineContent(c || '') });
  }

  if (blocks.length === 0) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }];
  }
  return blocks;
}

/**
 * Détecte automatiquement le format (JSONL compact vs texte libre) et convertit en BlockNote.
 */
export function toBlockNoteAuto(input: string): any[] {
  if (!input || !input.trim()) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }];
  }

  // Heuristique: considérer JSONL si au moins 3 lignes JSON valides sur les 6 premières non vides
  const lines = input.split(/\r?\n/).filter(l => l.trim().length > 0);
  const sample = lines.slice(0, 6);
  let ok = 0;
  for (const l of sample) {
    const t = l.trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o.t === 'string') ok++;
    } catch {}
  }
  if (ok >= 3) {
    return toBlockNoteFromJSONL(input);
  }
  return toBlockNote(input);
}

/**
 * Supprime le bruit de "réflexion" que les modèles écrivent parfois hors <thinking>,
 * retire les blocs de code fences ```...``` et nettoie l'entête narrative ("Je vais …", "Plan détaillé", etc.).
 */
export function sanitizeAIGeneratedContent(input: string): string {
  if (!input) return '';
  let out = String(input);
  // 1) Retirer toute réflexion balisée
  out = out.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  // 2) Retirer blocs de code fences (ex: ```json ... ```)
  out = out.replace(/```[a-zA-Z0-9]*[\s\S]*?```/g, '');
  // 3) Nettoyer les lignes d'entête narratives au début
  const lines = out.split(/\r?\n/);
  const narrativeRe = /^(je\s+(vais|dois|suis|commence|utilise|vais\s+générer|vais\s+vérifier)|j[’'](ai|irai|utilise)|plan\s+détaillé|révision\s+des\s+règles|exemples?|attention|alternative)/i;
  let idx = 0;
  while (idx < lines.length) {
    const t = lines[idx].trim();
    if (!t || narrativeRe.test(t)) {
      idx++;
      continue;
    }
    // Si ligne JSONL ou contenu structuré, on démarre
    if (t.startsWith('{') || t.startsWith('##') || t.startsWith('###') || t.startsWith('- ') || t.startsWith('* ') || /^\d+\.\s+/.test(t) || t.startsWith('$$') || t.startsWith('$')) {
      break;
    }
    // Si c'est une vraie phrase de contenu (pas de narration évidente), on démarre
    break;
  }
  out = lines.slice(idx).join('\n');
  return out.trimStart();
}