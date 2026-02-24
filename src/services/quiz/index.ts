// Export du service principal (refactorisé)
export { AIQuizService } from "./aiQuizService.js";

// Export des types
export * from "./types.js";

// Export du service métier
export { QuizService } from "./quizService.js";

// Export des nouveaux modules refactorisés
export * from "./levels/index.js";
export * from "./utils/index.js";
export * from "./generators/index.js";

// Export des enums pour faciliter l'utilisation
export { SchoolLevel, LyceeSpecialty, QuestionType } from "./types.js";
