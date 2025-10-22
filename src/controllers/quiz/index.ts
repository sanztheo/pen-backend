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
export { validateSourceDocuments } from './utils/validators.js';

// ===== QUIZ DE BASE =====
export { QuizController } from './quiz/quizController.js';
export { PreferencesController } from './quiz/preferencesController.js';

// ===== SÉQUENCES =====
export { SequenceController } from './sequences/sequenceController.js';
export { SequenceDebugController } from './sequences/sequenceDebugController.js';

// ===== DOCUMENTS =====
export { DocumentController } from './documents/documentController.js';

// ===== ASSISTANT OPENAI =====
export { AssistantHealthController } from './assistant/assistantHealthController.js';
export { AssistantGenerationController } from './assistant/generationController.js';
export { AssistantCorrectionController } from './assistant/correctionController.js';

// ===== CONTENU (Pages/Projets/RAG) =====
export { PagesProjectsController } from './content/pagesProjectsController.js';
export { RAGController } from './content/ragController.js';

/**
 * Classe unifiée QuizController pour rétrocompatibilité
 *
 * Cette classe agrège toutes les méthodes des contrôleurs modulaires
 * pour maintenir la compatibilité avec l'ancien code qui importe
 * directement depuis QuizController.
 */
import { QuizController as BaseQuizController } from './quiz/quizController.js';
import { PreferencesController } from './quiz/preferencesController.js';
import { SequenceController } from './sequences/sequenceController.js';
import { SequenceDebugController } from './sequences/sequenceDebugController.js';
import { DocumentController } from './documents/documentController.js';
import { AssistantHealthController } from './assistant/assistantHealthController.js';
import { AssistantGenerationController } from './assistant/generationController.js';
import { AssistantCorrectionController } from './assistant/correctionController.js';
import { PagesProjectsController } from './content/pagesProjectsController.js';
import { RAGController } from './content/ragController.js';

/**
 * Contrôleur unifié exporté pour compatibilité avec l'ancien fichier quiz.ts
 *
 * Utilise Object.assign pour fusionner tous les contrôleurs modulaires
 * en une seule classe accessible via QuizController.methodName()
 */
export const UnifiedQuizController = Object.assign(
  {},
  // Quiz de base
  BaseQuizController,
  // Préférences
  PreferencesController,
  // Séquences
  SequenceController,
  SequenceDebugController,
  // Documents
  DocumentController,
  // Assistant
  AssistantHealthController,
  AssistantGenerationController,
  AssistantCorrectionController,
  // Contenu
  PagesProjectsController,
  RAGController
);

// Export par défaut pour rétrocompatibilité
export default UnifiedQuizController;
