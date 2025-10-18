import { Router } from 'express';
import { QuizController } from '../controllers/quiz.js';
import { QuizStreamingController } from '../controllers/quizStreaming.js';
import { authenticateToken } from '../middlewares/auth.js';
import { requireCustomQuizLimits, requirePresetSequenceLimits } from '../middlewares/requireQuizLimits.js';
import { requireAICredits } from '../middlewares/requireAICredits.js';
import { requirePremiumPlan } from '../middlewares/requirePremiumPlan.js';
import quizStatsRouter from './quizStats.js';

const router = Router();

// Route de streaming SSE (SANS authentification middleware car EventSource ne peut pas envoyer de headers)
router.get('/stream/:sessionId', QuizStreamingController.streamQuizGeneration);

// Middleware d'authentification pour toutes les autres routes quiz
router.use(authenticateToken);

// Routes de génération et gestion des quiz
router.post('/generate', requireCustomQuizLimits(), QuizController.generateQuiz);

// ===== NOUVELLES ROUTES POUR LE STREAMING =====
// Approche EventSource avec session
router.post('/streaming-session', requireCustomQuizLimits(), QuizStreamingController.createStreamingSession);
router.get('/stream-status/:id', QuizStreamingController.getStreamStatus);

// Routes de compatibilité (anciennes)
router.post('/generate-stream', requireCustomQuizLimits(), QuizStreamingController.generateQuizStream);
router.get('/history', QuizController.getQuizHistory);
router.get('/preferences', QuizController.getUserPreferences);
router.put('/preferences', QuizController.updateUserPreferences);

// ===== NOUVELLES ROUTES POUR PAGES ET PROJETS =====
// IMPORTANT: Ces routes doivent être AVANT /:id pour éviter les conflits

// Route pour récupérer les pages et projets disponibles
router.get('/pages-projects', QuizController.getPagesProjects);
router.post('/analyze-pages-projects', QuizController.analyzePagesProjects);
router.post('/context-rag', QuizController.buildQuizRAGContext);

// Routes spécifiques à un quiz
router.get('/:id', QuizController.getQuiz);
router.post('/:id/submit', QuizController.submitQuiz);

// ===== NOUVELLE ROUTE POUR CORRECTION STREAMING =====
router.post('/submit-and-correct-stream', QuizStreamingController.submitAndCorrectStream);

// ===== NOUVELLE ROUTE POUR RETAKE (refaire un quiz) =====
router.post('/retake/:quizId', QuizStreamingController.retakeQuiz);

// ===== NOUVELLE ROUTE POUR CORRECTION RAPIDE =====
router.post('/save-fast-correction', QuizController.saveFastCorrection);

// ===== NOUVELLES ROUTES POUR QUIZ SÉQUENTIELS =====

// Routes de gestion des presets et quiz séquentiels
router.post('/preset/start', requirePresetSequenceLimits(), QuizController.startPresetSequence);
router.get('/sequence/:sequenceId', QuizController.getSequenceStatus);
router.post('/sequence/:sequenceId/next', QuizController.generateNextQuiz);
// 🚀 NOUVELLE ROUTE - Génération parallèle avec 2 assistants (🛡️ PREMIUM REQUIS)
router.post('/sequence/:sequenceId/parallel-generate', requirePremiumPlan(), QuizController.generateParallelQuizzes);
router.get('/sequence/:sequenceId/results', QuizController.getSequenceResults);

// Routes pour corriger et naviguer dans les séquences
router.post('/sequence/:sequenceId/quiz/:quizId/submit', QuizController.submitSequentialQuiz);
router.get('/sequence/:sequenceId/quiz/:quizId/correction', QuizController.getQuizCorrection);

// 🔧 ROUTE DEBUG - Forcer la réinitialisation d'état de séquence
router.post('/sequence/:sequenceId/debug/force-reset', QuizController.forceResetSequenceState);

// ===== NOUVELLES ROUTES POUR RECHERCHE DOCUMENTAIRE =====

// Routes de recherche dans les documents Wikipedia
router.post('/search-documents', QuizController.searchDocuments);
router.get('/documents/stats', QuizController.getDocumentStats);

// ===== NOUVELLES ROUTES POUR ASSISTANT OPENAI =====

// 🛡️ ROUTES ASSISTANT OPENAI SÉCURISÉES - Premium + Crédits IA requis
router.post('/assistant/thread', requirePremiumPlan(), requireAICredits({ cost: 0.2, action: 'assistant_thread' }), QuizController.createAssistantThread);
router.post('/assistant/ping', requirePremiumPlan(), requireAICredits({ cost: 0.1, action: 'assistant_ping' }), QuizController.pingAssistant);
router.post('/assistant/test-simple', requirePremiumPlan(), requireAICredits({ cost: 0.3, action: 'assistant_test' }), QuizController.testSimpleAssistant);

// 🛡️ ROUTES GÉNÉRATION ASSISTANT - Premium + Crédits IA élevés (fonctionnalités coûteuses)
router.post('/assistant/generate-graphics', requirePremiumPlan(), requireAICredits({ cost: 5.0, action: 'assistant_graphics' }), QuizController.generateAssistantGraphics);
router.post('/assistant/generate-documents', requirePremiumPlan(), requireAICredits({ cost: 3.0, action: 'assistant_documents' }), QuizController.generateAssistantDocuments);
router.post('/assistant/generate-documents-full', requirePremiumPlan(), requireAICredits({ cost: 4.0, action: 'assistant_documents_full' }), QuizController.generateAssistantDocumentsFull);
router.post('/assistant/generate-complete', requirePremiumPlan(), requireAICredits({ cost: 8.0, action: 'assistant_complete' }), QuizController.generateAssistantComplete);
router.post('/assistant/generate-standard', requirePremiumPlan(), requireAICredits({ cost: 2.0, action: 'assistant_standard' }), QuizController.generateAssistantStandard);

// 🛡️ ROUTES CORRECTION ASSISTANT - Premium + Crédits IA pour corrections spécialisées
router.post('/assistant/correct-standard', requirePremiumPlan(), requireAICredits({ cost: 1.5, action: 'assistant_correct_standard' }), QuizController.correctAssistantStandard);
router.post('/assistant/correct-graphics', requirePremiumPlan(), requireAICredits({ cost: 3.0, action: 'assistant_correct_graphics' }), QuizController.correctAssistantGraphics);
router.post('/assistant/correct-documents', requirePremiumPlan(), requireAICredits({ cost: 2.0, action: 'assistant_correct_documents' }), QuizController.correctAssistantDocuments);
router.post('/assistant/correct-complete', requirePremiumPlan(), requireAICredits({ cost: 5.0, action: 'assistant_correct_complete' }), QuizController.correctAssistantComplete);

// Routes d'analyse et statistiques (Phase 4)
router.post('/analyze-workspace', (req, res) => {
  res.status(501).json({ 
    message: 'Analyse de workspace disponible dans une version future' 
  });
});

// Routes de statistiques détaillées
router.use('/statistics', quizStatsRouter);

export default router; 