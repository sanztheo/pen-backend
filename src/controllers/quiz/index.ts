/**
 * Point d'entrée principal pour les contrôleurs de quiz
 *
 * Ce fichier réexporte tous les contrôleurs modulaires pour faciliter les imports
 * et maintenir une API cohérente avec l'ancien fichier quiz.ts monolithique.
 *
 * Architecture:
 * - utils/validators.ts : Utilitaires de validation
 * - quiz/ : Opérations CRUD de base et préférences
 * - sequences/ : Gestion des séquences de quiz
 * - documents/ : Recherche documentaire
 * - assistant/ : Intégration OpenAI Assistant
 * - content/ : Pages, projets et contexte RAG
 */

// ===== UTILITAIRES =====
export { validateSourceDocuments } from "./utils/validators.js";

// ===== QUIZ DE BASE =====
export { QuizController } from "./quiz/quizController.js";
export { PreferencesController } from "./quiz/preferencesController.js";

// ===== SÉQUENCES =====
export { SequenceController } from "./sequences/sequenceController.js";
export { SequenceDebugController } from "./sequences/sequenceDebugController.js";

// ===== DOCUMENTS =====
export { DocumentController } from "./documents/documentController.js";

// ===== CONTENU (Pages/Projets/RAG) =====
export { PagesProjectsController } from "./content/pagesProjectsController.js";
export { RAGController } from "./content/ragController.js";

// ===== ASSISTANT / PREPROCESSOR =====
export { PreprocessorController } from "./assistant/preprocessorController.js";

/**
 * Classe unifiée QuizController pour rétrocompatibilité
 *
 * Cette classe agrège toutes les méthodes des contrôleurs modulaires
 * pour maintenir la compatibilité avec l'ancien code qui importe
 * directement depuis QuizController.
 */
import { QuizController as BaseQuizController } from "./quiz/quizController.js";
import { PreferencesController } from "./quiz/preferencesController.js";
import { SequenceController } from "./sequences/sequenceController.js";
import { SequenceDebugController } from "./sequences/sequenceDebugController.js";
import { DocumentController } from "./documents/documentController.js";
import { PagesProjectsController } from "./content/pagesProjectsController.js";
import { RAGController } from "./content/ragController.js";
import { PreprocessorController } from "./assistant/preprocessorController.js";

/**
 * Helper function to copy all static methods from a class to a target object
 */
function copyStaticMethods(target: any, source: any) {
  Object.getOwnPropertyNames(source).forEach((key) => {
    if (key !== "prototype" && key !== "length" && key !== "name") {
      target[key] = source[key];
    }
  });
}

/**
 * Contrôleur unifié exporté pour compatibilité avec l'ancien fichier quiz.ts
 *
 * Fusionne toutes les méthodes statiques des contrôleurs modulaires
 * en un seul objet accessible via QuizController.methodName()
 */
const UnifiedQuizControllerObj: any = {};

// Quiz de base
copyStaticMethods(UnifiedQuizControllerObj, BaseQuizController);
// Préférences
copyStaticMethods(UnifiedQuizControllerObj, PreferencesController);
// Séquences
copyStaticMethods(UnifiedQuizControllerObj, SequenceController);
copyStaticMethods(UnifiedQuizControllerObj, SequenceDebugController);
// Documents
copyStaticMethods(UnifiedQuizControllerObj, DocumentController);
// Contenu
copyStaticMethods(UnifiedQuizControllerObj, PagesProjectsController);
copyStaticMethods(UnifiedQuizControllerObj, RAGController);
// Assistant / Preprocessor
copyStaticMethods(UnifiedQuizControllerObj, PreprocessorController);

export const UnifiedQuizController = UnifiedQuizControllerObj;

// Export par défaut pour rétrocompatibilité
export default UnifiedQuizController;
