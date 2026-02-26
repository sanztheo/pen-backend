// Import nécessaire pour la fonction
import { QuizPreset } from "../types.js";

// Export des modules de presets avec résolution des conflits
export {
  BREVET_CONFIG,
  createBrevetSequentialConfig,
  generateBrevetSubjectRequest,
  calculateBrevetGlobalScore,
  getBrevetPrompt,
} from "./brevet/index.js";

export {
  BAC_CONFIG,
  createBacSequentialConfig,
  generateBacSubjectRequest,
  calculateBacGlobalScore,
  getBacPrompt,
} from "./bac/index.js";

export {
  PARTIELS_CONFIG,
  createPartielsSequentialConfig,
  generatePartielsSubjectRequest,
  calculatePartielsGlobalScore,
  getPartielsPrompt,
  getCurrentSubjectName,
  getAvailableFilieres,
} from "./partiels/index.js";

export * from "./sequenceManager.js";

// Export des fonctions communes avec préfixe pour éviter les conflits
export { getSubjectDisplayName as getBrevetSubjectDisplayName } from "./brevet/index.js";
export { getSubjectDisplayName as getBacSubjectDisplayName } from "./bac/index.js";

// Types et enums spécifiques aux presets
export { QuizPreset, ExamSubject } from "../types.js";
export type { SequentialQuizConfig, SubjectResult } from "../types.js";

// Fonction utilitaire pour obtenir la liste de tous les presets disponibles
export function getAvailablePresets(): { value: QuizPreset; label: string; description: string }[] {
  return [
    {
      value: "NONE" as QuizPreset,
      label: "Quiz Libre",
      description: "Quiz personnalisé sans structure d'examen",
    },
    {
      value: "BREVET" as QuizPreset,
      label: "Brevet des Collèges",
      description: "Simulation complète du Diplôme National du Brevet (4 épreuves)",
    },
    {
      value: "BAC" as QuizPreset,
      label: "Baccalauréat Général",
      description: "Simulation complète du Bac général (Philosophie + 2 spécialités + Grand Oral)",
    },
    {
      value: "PARTIELS" as QuizPreset,
      label: "Partiels Universitaires",
      description: "Examens de fin de semestre selon votre filière d'études supérieures",
    },
  ];
}
