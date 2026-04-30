import { Router } from "express";
import { UnifiedQuizController as QuizController } from "../controllers/quiz/index.js";
import { QuizStreamingController } from "../controllers/quiz-streaming/index.js";
import { authenticateToken } from "../middlewares/auth.js";
import {
  requireCustomQuizLimits,
  requirePresetSequenceLimits,
} from "../middlewares/requireQuizLimits.js";
import {
  preprocessorRateLimit,
  quizCorrectSingleRateLimit,
  quizCompleteRateLimit,
  quizGenerationRateLimit,
} from "../middlewares/rateLimiting.js";
import { quizStatsRouter } from "./quizStats.js";

const router = Router();

// SSE streaming: EventSource can't send Authorization headers, so authenticateToken
// middleware won't work. Auth is handled inside the controller via ?token= query param
// (JWT verified + session ownership checked in QuizStreamingController.streamQuizGeneration)
router.get("/stream/:sessionId", QuizStreamingController.streamQuizGeneration);

// Middleware d'authentification pour toutes les autres routes quiz
router.use(authenticateToken);

// Routes de génération et gestion des quiz
router.post("/generate", requireCustomQuizLimits(), QuizController.generateQuiz);

// PEN-35: Route pour le preprocessor (analyse et recommandations)
// SÉCURITÉ: Rate limit par userId (30 req/15min) pour éviter abus de l'IA
router.post("/preprocess", preprocessorRateLimit, QuizController.preprocessQuiz);

// ===== NOUVELLES ROUTES POUR LE STREAMING =====
// Approche EventSource avec session
// SÉCURITÉ: Rate limit 5 req/min par user (chaque génération = 4-7 LLM calls)
router.post(
  "/streaming-session",
  quizGenerationRateLimit,
  requireCustomQuizLimits(),
  QuizStreamingController.createStreamingSession,
);
router.get("/stream-status/:id", QuizStreamingController.getStreamStatus);

// Routes de compatibilité (anciennes)
router.post(
  "/generate-stream",
  quizGenerationRateLimit,
  requireCustomQuizLimits(),
  QuizStreamingController.generateQuizStream,
);
router.get("/history", QuizController.getQuizHistory);
router.get("/preferences", QuizController.getUserPreferences);
router.put("/preferences", QuizController.updateUserPreferences);

// ===== NOUVELLES ROUTES POUR PAGES ET PROJETS =====
// IMPORTANT: Ces routes doivent être AVANT /:id pour éviter les conflits

// Route pour récupérer les pages et projets disponibles
router.get("/pages-projects", QuizController.getPagesProjects);
router.post("/analyze-pages-projects", QuizController.analyzePagesProjects);
router.post("/context-rag", QuizController.buildQuizRAGContext);

// Pipeline correction routes
// SÉCURITÉ: Rate limit par userId pour éviter abus LLM (60 req/10min, 10 req/10min)
router.post(
  "/:id/correct-single",
  quizCorrectSingleRateLimit,
  QuizStreamingController.correctSingleQuestion,
);
router.post("/:id/complete", quizCompleteRateLimit, QuizStreamingController.completeQuiz);

// Routes spécifiques à un quiz
router.get("/:id", QuizController.getQuiz);
router.post("/:id/submit", QuizController.submitQuiz);

// ===== NOUVELLE ROUTE POUR CORRECTION STREAMING =====
router.post("/submit-and-correct-stream", QuizStreamingController.submitAndCorrectStream);

// ===== NOUVELLE ROUTE POUR CORRECTION RAPIDE =====
router.post("/save-fast-correction", QuizController.saveFastCorrection);

// ===== NOUVELLES ROUTES POUR QUIZ SÉQUENTIELS =====

// Routes de gestion des presets et quiz séquentiels
router.post("/preset/start", requirePresetSequenceLimits(), QuizController.startPresetSequence);
router.get("/sequence/:sequenceId", QuizController.getSequenceStatus);
router.post("/sequence/:sequenceId/next", QuizController.generateNextQuiz);
router.get("/sequence/:sequenceId/results", QuizController.getSequenceResults);

// Routes pour corriger et naviguer dans les séquences
router.post("/sequence/:sequenceId/quiz/:quizId/submit", QuizController.submitSequentialQuiz);
router.get("/sequence/:sequenceId/quiz/:quizId/correction", QuizController.getQuizCorrection);

// 🔧 ROUTE DEBUG - Forcer la réinitialisation d'état de séquence
// Disabled in production: this bypasses sequence integrity checks and exists for local debugging only.
if (process.env.NODE_ENV !== "production") {
  router.post("/sequence/:sequenceId/debug/force-reset", QuizController.forceResetSequenceState);
}

// ===== NOUVELLES ROUTES POUR RECHERCHE DOCUMENTAIRE =====

// Routes de recherche dans les documents Wikipedia
router.post("/search-documents", QuizController.searchDocuments);
router.get("/documents/stats", QuizController.getDocumentStats);

// Routes d'analyse et statistiques (Phase 4)
router.post("/analyze-workspace", (req, res) => {
  res.status(501).json({
    message: "Analyse de workspace disponible dans une version future",
  });
});

// Routes de statistiques détaillées
router.use("/statistics", quizStatsRouter);

export { router as quizRouter };
