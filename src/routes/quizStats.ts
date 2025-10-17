import { Router } from 'express';
import { QuizStatsController } from '../controllers/quizStats';

const router = Router();

/**
 * Routes pour les statistiques de quiz
 * Base: /api/quiz/statistics
 */

// Récupérer toutes les stats en une fois (optimisé)
router.get('/all', QuizStatsController.getAllStats);

// Stats avancées générales
router.get('/advanced', QuizStatsController.getAdvancedStats);

// Progression dans le temps
router.get('/progression', QuizStatsController.getProgression);

// Répartition par matière
router.get('/subjects', QuizStatsController.getSubjectBreakdown);

// Analyse par difficulté
router.get('/difficulty', QuizStatsController.getDifficultyAnalysis);

// Analyse du temps
router.get('/time', QuizStatsController.getTimeAnalytics);

// Pages sources utilisées
router.get('/sources', QuizStatsController.getPageSources);

// Types de questions
router.get('/question-types', QuizStatsController.getQuestionTypeStats);

// Layout du dashboard
router.get('/layout', QuizStatsController.getLayout);
router.put('/layout', QuizStatsController.saveLayout);
router.post('/layout/reset', QuizStatsController.resetLayout);

export default router;

