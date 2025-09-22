export function isMathLatexIntent(query: string): boolean {
  const q = String(query || '').toLowerCase();
  const keywords = [
    'latex','laTeX','équation','equation','formule','formules','math','maths','mathématiques','mathematics','écrire en latex','ecrire en latex','notation latex','notation math'
  ];
  return keywords.some(k => q.includes(k));
}

export const LATEX_STRICT_RULES = `
Règles LaTeX STRICTES OBLIGATOIRES:
- FERMETURE OBLIGATOIRE: Toute formule DOIT être correctement fermée. Chaque $ doit avoir son $ fermant, chaque $$ doit avoir son $$ fermant.
- ÉQUILIBRAGE STRICT: Toute accolade { doit avoir sa fermeture }, tout crochet [ doit avoir sa fermeture ], toute parenthèse ( doit avoir sa fermeture ).
- Encadre TOUTE formule par $...$ (inline) ou $$...$$ (display) - VÉRIFIER la fermeture avant de valider.
- Ne mets JAMAIS de texte français (ou caractères accentués) ENTRE les délimiteurs $...$ ou $$...$$.
- Évite toute macro de section (\\section, \\subsection, etc.) et les environnements (equation, align, etc.). Utilise uniquement $ ou $$ avec du contenu math pur.
- L'explication en français doit être HORS des délimiteurs, sur la même ligne après la formule, séparée par " — ".
- Exemples corrects: $$A=\\pi r^{2}$$ — aire d'un cercle. $a^2-b^2=(a-b)(a+b)$ — différence de carrés.
- STRICT: NE PAS inclure de texte avant/après dans le même bloc $$...$$. Le bloc $$...$$ doit contenir UNIQUEMENT des symboles mathématiques.
- NE PAS mélanger ponctuation ou tirets (—, -, :) dans $$...$$. Place-les en dehors.
- Si une phrase commence par "Donc," ou similaire, elle DOIT être hors du bloc: exemple: "Donc, $$\\sqrt{52} \\approx 7,21$$." et non "$$Donc, \\sqrt{52} \\approx 7,21$$".
- VALIDATION: Avant de valider ton contenu, compte tes délimiteurs $ et $$ pour t'assurer qu'ils sont équilibrés.
- Quand tu écris une définition avec explication: $$c^2 = a^2 + b^2 - 2ab \\cos(\\gamma)$$ — où $c$ est le côté opposé à $\\gamma$.
`;