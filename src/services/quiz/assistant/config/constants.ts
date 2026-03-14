// assistant/config/constants.ts - Constantes et labels pour l'assistant quiz

export const SPECIALTY_LABELS: Record<string, string> = {
  MATHEMATIQUES: "Mathématiques",
  PHYSIQUE_CHIMIE: "Physique-Chimie",
  SVT: "Sciences de la Vie et de la Terre",
  HISTOIRE_GEO: "Histoire-Géographie",
  SES: "Sciences Économiques et Sociales",
  LANGUES: "Langues Vivantes",
  LITTERATURE: "Littérature",
  ARTS: "Arts",
  NSI: "Numérique et Sciences Informatiques",
  SI: "Sciences de l'Ingénieur",
  PHILOSOPHIE: "Philosophie",
  EPS: "Éducation Physique et Sportive",
  LANGUES_CULTURES_ANTIQUITE: "Langues et Cultures de l'Antiquité",
  BIOLOGIE_ECOLOGIE: "Biologie-Écologie",
  SCIENCES_INGENIEUR: "Sciences de l'Ingénieur",
  ARTS_PLASTIQUES: "Arts Plastiques",
  MUSIQUE: "Musique",
  THEATRE: "Théâtre",
  CINEMA_AUDIOVISUEL: "Cinéma-Audiovisuel",
  DANSE: "Danse",
  HISTOIRE_ARTS: "Histoire des Arts",
};

export const formatSpecialtyLabel = (specialty?: string): string | undefined => {
  if (!specialty) {
    return undefined;
  }

  return SPECIALTY_LABELS[specialty] || specialty.replace(/_/g, " ");
};
