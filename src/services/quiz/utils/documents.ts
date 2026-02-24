/**
 * Utilitaire commun pour déterminer si un sujet doit inclure des documents Wikipedia
 * Normalise le nom de matière et applique des règles explicites par matière.
 */

export function shouldIncludeDocumentsForSubject(subject: string): boolean {
  const normalized = String(subject || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  // Matières où les documents n'apportent pas de valeur (calcul/logique)
  const disabled = [
    "mathematiques",
    "mathematique",
    "maths",
    "math",
    "mathematiquesspecialite",
    "physique",
    "chimie",
    "physiquechimie",
    "physiquechimiespecialite",
    "nsi",
    "nsispecialite",
    "si",
    "sispecialite",
    "informatique",
  ];
  if (disabled.some((x) => normalized.includes(x))) return false;

  // Matières littéraires/historiques où des documents sont utiles
  const enabled = [
    "francais",
    "francais",
    "litterature",
    "litterature",
    "histoire",
    "geographie",
    "histoiregeographie",
    "histoiregeographieemc",
    "philosophie",
    "hggsp",
    "hlp",
    "humanites",
    "humanites",
    "sciences",
  ];
  if (enabled.some((x) => normalized.includes(x))) return true;

  // Par défaut, activer pour les sujets inconnus (comportement conservateur)
  return true;
}
