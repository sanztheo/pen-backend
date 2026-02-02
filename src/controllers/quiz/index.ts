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

// Note: Ce helper utilise 'object' car il copie dynamiquement des méthodes statiques de classes.
// Le cast interne vers Record est nécessaire pour l'accès par index.
function copyStaticMethods<TTarget extends object, TSource extends object>(
  target: TTarget,
  source: TSource,
) {
  Object.getOwnPropertyNames(source).forEach((key) => {
    if (key !== "prototype" && key !== "length" && key !== "name") {
      (target as Record<string, unknown>)[key] = (
        source as Record<string, unknown>
      )[key];
    }
  });
}

/**
 * Contrôleur unifié exporté pour compatibilité avec l'ancien fichier quiz.ts
 *
 * Fusionne toutes les méthodes statiques des contrôleurs modulaires
 * en un seul objet accessible via QuizController.methodName()
 *
 * Note: Typage explicite requis car les méthodes sont copiées dynamiquement
 * et doivent être compatibles avec les handlers Express.
 */
type UnifiedQuizControllerType = typeof BaseQuizController &
  typeof PreferencesController &
  typeof SequenceController &
  typeof SequenceDebugController &
  typeof DocumentController &
  typeof PagesProjectsController &
  typeof RAGController &
  typeof PreprocessorController;

const UnifiedQuizControllerObj = {} as UnifiedQuizControllerType;

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
