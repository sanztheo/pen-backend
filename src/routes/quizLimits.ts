/**
 * 🎓 ROUTES API POUR LES LIMITES DE QUIZ
 * Endpoints pour la gestion des limitations de quiz personnalisés et presets
 */

import { logger } from "../utils/logger.js";
import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { Request } from "express";
import { AuthUser } from "../services/auth.js";
import { QuizLimitsService } from "../services/credits/quizLimitsService.js";

const router = express.Router();

// Interface pour les requêtes authentifiées
interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * GET /api/quiz-limits/custom/check
 * Vérifier les limites de quiz personnalisés
 */
router.get("/custom/check", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await QuizLimitsService.canCreateCustomQuiz(userId);

    res.json({
      success: result.success,
      canCreate: result.success,
      remainingQuizzes: result.remainingQuizzes,
      limitReached: result.limitReached,
      message: result.message,
      limitType: "quiz-custom",
    });
  } catch (error) {
    logger.error("Erreur vérification limites quiz personnalisés:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la vérification des limites",
      canCreate: false,
      remainingQuizzes: 0,
    });
  }
});

/**
 * GET /api/quiz-limits/preset/check/:preset
 * Vérifier les limites de séquences preset
 */
router.get("/preset/check/:preset", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { preset } = req.params;

    const result = await QuizLimitsService.canCreatePresetSequence(userId, preset);

    res.json({
      success: result.success,
      canCreate: result.success,
      limitReached: result.limitReached,
      message: result.message,
      limitType: "quiz-preset",
      existingSequence: result.existingSequence,
    });
  } catch (error) {
    logger.error("Erreur vérification limites séquences preset:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la vérification des limites",
      canCreate: false,
    });
  }
});

/**
 * POST /api/quiz-limits/custom/deduct
 * Déduire un quota de quiz personnalisé
 */
router.post("/custom/deduct", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await QuizLimitsService.deductCustomQuiz(userId);

    if (result.success) {
      res.json({
        success: true,
        remainingQuizzes: result.remainingQuizzes,
        message: result.message,
      });
    } else {
      res.status(403).json({
        success: false,
        error: "CUSTOM_QUIZ_LIMIT_REACHED",
        remainingQuizzes: result.remainingQuizzes,
        limitReached: result.limitReached,
        message: result.message,
        limitType: "quiz-custom",
      });
    }
  } catch (error) {
    logger.error("Erreur déduction quiz personnalisé:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la déduction",
      remainingQuizzes: 0,
    });
  }
});

/**
 * POST /api/quiz-limits/preset/start
 * Démarrer une nouvelle séquence de preset
 */
router.post("/preset/start", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { preset, subjects, totalSubjects, specialties, higherEdField, workspaceIds, metadata } =
      req.body;

    // Validation des données requises
    if (!preset || !subjects || !totalSubjects) {
      return res.status(400).json({
        success: false,
        error: "MISSING_REQUIRED_FIELDS",
        message: "Les champs preset, subjects et totalSubjects sont requis",
      });
    }

    // Vérifier les limites
    const canCreate = await QuizLimitsService.canCreatePresetSequence(userId, preset);

    if (!canCreate.success) {
      return res.status(403).json({
        success: false,
        error: "PRESET_SEQUENCE_LIMIT_REACHED",
        message: canCreate.message,
        limitType: "quiz-preset",
        existingSequence: canCreate.existingSequence,
      });
    }

    // Démarrer la séquence
    const sequenceData = {
      subjects,
      totalSubjects,
      specialties: specialties || [],
      higherEdField,
      workspaceIds: workspaceIds || [],
      metadata: metadata || {},
    };

    const result = await QuizLimitsService.startPresetSequence(userId, preset, sequenceData);

    if (result.success) {
      res.json({
        success: true,
        sequenceId: result.sequenceId,
        message: result.message,
      });
    } else {
      res.status(403).json({
        success: false,
        error: "PRESET_SEQUENCE_START_FAILED",
        message: result.message,
        limitType: "quiz-preset",
      });
    }
  } catch (error) {
    logger.error("Erreur démarrage séquence preset:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors du démarrage de la séquence",
    });
  }
});

/**
 * POST /api/quiz-limits/refund
 * Rembourser un quota de quiz en cas d'erreur
 */
router.post("/refund", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { type, reason } = req.body;

    // Validation du type
    if (!type || !["custom", "preset"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_REFUND_TYPE",
        message: 'Le type doit être "custom" ou "preset"',
      });
    }

    const result = await QuizLimitsService.refundQuiz(userId, type);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        refundType: type,
        reason: reason || "manual_refund",
      });
    } else {
      res.status(400).json({
        success: false,
        error: "REFUND_FAILED",
        message: result.message,
      });
    }
  } catch (error) {
    logger.error("Erreur remboursement quota quiz:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors du remboursement",
    });
  }
});

/**
 * GET /api/quiz-limits/status
 * Obtenir le statut complet des limites de quiz pour l'utilisateur
 */
router.get("/status", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Vérifier les limites des quiz personnalisés
    const customResult = await QuizLimitsService.canCreateCustomQuiz(userId);

    // Vérifier les séquences preset existantes
    const presetResults = await Promise.all([
      QuizLimitsService.canCreatePresetSequence(userId, "BREVET"),
      QuizLimitsService.canCreatePresetSequence(userId, "BAC"),
      QuizLimitsService.canCreatePresetSequence(userId, "PARTIELS"),
    ]);

    // Extraire les séquences existantes
    const existingSequences = presetResults
      .filter((result) => result.existingSequence)
      .map((result) => result.existingSequence);

    res.json({
      success: true,
      customQuizzes: {
        canCreate: customResult.success,
        remainingQuizzes: customResult.remainingQuizzes,
        limitReached: customResult.limitReached,
      },
      presetSequences: {
        canCreate: presetResults.some((result) => result.success),
        existingSequences,
        hasActiveSequence: existingSequences.length > 0,
      },
    });
  } catch (error) {
    logger.error("Erreur récupération statut limites quiz:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la récupération du statut",
    });
  }
});

export { router as quizLimitsRouter };
