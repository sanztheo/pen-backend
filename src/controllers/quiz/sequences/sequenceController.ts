import { Request, Response } from "express";
import { QuizService } from "../../../services/quiz/quizService.js";
import { prisma } from "../../../lib/prisma.js";
import { validateSourceDocuments } from "../utils/validators.js";
import { z } from "zod";
import { LyceeSpecialty, QuizPreset } from "../../../services/quiz/types.js";

const StartPresetSequenceBodySchema = z.object({
  preset: z.nativeEnum(QuizPreset),
  selectedSpecialties: z.array(z.nativeEnum(LyceeSpecialty)).optional(),
  higherEdField: z.string().min(1).optional(),
  workspaceIds: z.array(z.string()).optional(),
});

/**
 * Contrôleur pour la gestion des séquences de quiz
 */
export class SequenceController {
  /**
   * POST /api/quiz/preset/start - Démarre une séquence de quiz preset
   */
  static async startPresetSequence(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const parsedBody = StartPresetSequenceBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: "Données invalides", details: parsedBody.error.errors });
        return;
      }
      const { preset, selectedSpecialties, higherEdField, workspaceIds } =
        parsedBody.data;

      if (!preset) {
        res.status(400).json({ error: "Type de preset requis" });
        return;
      }

      // Validation spécifique par preset
      if (
        preset === "BAC" &&
        (!selectedSpecialties || selectedSpecialties.length !== 2)
      ) {
        res
          .status(400)
          .json({ error: "Exactement 2 spécialités requises pour le Bac" });
        return;
      }

      if (preset === "PARTIELS" && !higherEdField) {
        res
          .status(400)
          .json({ error: "Filière d'études requise pour les Partiels" });
        return;
      }

      // Création de la séquence via QuizService
      const result = await QuizService.startPresetSequence({
        userId,
        preset,
        specialties: selectedSpecialties,
        higherEdField,
        workspaceIds: workspaceIds || [],
      });

      // 🎯 INCRÉMENTER LE COMPTEUR presetSequencesUsed APRÈS CRÉATION RÉUSSIE
      try {
        await prisma.userLimits.upsert({
          where: { userId },
          update: {
            presetSequencesUsed: { increment: 1 },
          },
          create: {
            userId,
            presetSequencesUsed: 1,
            // Limites par défaut (FREE)
            aiCreditsLimit: 50,
            workspacesLimit: 2,
            projectsLimit: -1,
            customQuizzesLimit: 5,
            presetSequencesLimit: 1,
            aiCreditsUsed: 0,
            workspacesUsed: 0,
            projectsUsed: 0,
            customQuizzesUsed: 0,
          },
        });

        console.log(
          `✅ [PRESET-COUNTER] Compteur presetSequencesUsed incrémenté pour utilisateur: ${userId}`,
        );
      } catch (error) {
        console.error(
          `❌ [PRESET-COUNTER] Erreur incrémentation compteur pour utilisateur ${userId}:`,
          error,
        );
      }

      res.status(201).json({
        success: true,
        message: "Séquence de quiz créée avec succès",
        data: {
          sequenceId: result.sequenceId,
          preset,
          currentSubjectIndex: result.config.currentSubjectIndex,
          totalSubjects: result.config.totalSubjects,
          nextQuizSubject: result.config.subjects[0],
          firstQuizId: undefined, // Plus de génération automatique
          firstQuizGenerated: false,
        },
      });
    } catch (error) {
      console.error("Erreur création séquence preset:", error);
      res.status(500).json({
        error: "Erreur lors de la création de la séquence",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId - Récupère le statut d'une séquence
   */
  static async getSequenceStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: "ID de séquence requis" });
        return;
      }

      // Récupération de la configuration de séquence
      const config = await QuizService.getSequenceConfig(sequenceId, userId);

      res.status(200).json({
        success: true,
        data: { config },
      });
    } catch (error) {
      console.error("Erreur récupération séquence:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération de la séquence",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * POST /api/quiz/sequence/:sequenceId/next - Génère le quiz suivant dans la séquence
   */
  static async generateNextQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: "ID de séquence requis" });
        return;
      }

      // Génération du quiz suivant dans la séquence
      const result = await QuizService.generateNextQuizInSequence(
        sequenceId,
        userId,
      );

      res.status(201).json({
        success: true,
        message: "Quiz suivant généré avec succès",
        data: {
          quizId: result.quizId,
          subject: result.subject,
          isLastQuiz: result.isLastQuiz,
          quiz: result.quiz, // **NOUVEAU** : Quiz complet avec documents
        },
      });
    } catch (error) {
      console.error("Erreur génération quiz suivant:", error);
      res.status(500).json({
        error: "Erreur lors de la génération du quiz suivant",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId/results - Récupère les résultats complets de la séquence
   */
  static async getSequenceResults(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: "ID de séquence requis" });
        return;
      }

      // Récupération des résultats de la séquence
      const results = await QuizService.getSequenceResults(sequenceId, userId);

      res.status(200).json({
        success: true,
        data: { results },
      });
    } catch (error) {
      console.error("Erreur récupération résultats séquence:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération des résultats",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * POST /api/quiz/sequence/:sequenceId/quiz/:quizId/submit - Soumet un quiz séquentiel
   */
  static async submitSequentialQuiz(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId, quizId } = req.params;
      const { answers, sourceDocuments, hasDocuments } = req.body;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId || !quizId) {
        res.status(400).json({ error: "ID de séquence et quiz requis" });
        return;
      }

      if (!answers || !Array.isArray(answers)) {
        res
          .status(400)
          .json({ error: "Réponses requises sous forme de tableau" });
        return;
      }

      // 🛡️ Validation stricte de sourceDocuments pour éviter saturation mémoire
      const validation = validateSourceDocuments(sourceDocuments);
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error,
          ...validation.details,
        });
        return;
      }

      // Soumission du quiz séquentiel
      const result = await QuizService.submitSequentialQuiz(
        sequenceId,
        quizId,
        userId,
        answers,
        sourceDocuments,
        hasDocuments,
      );

      // Retourner immédiatement le résultat (correction en arrière-plan si nécessaire)
      res.status(200).json({
        success: true,
        message: result.result.isCorrectingInProgress
          ? "Quiz soumis, correction en cours..."
          : "Quiz soumis et corrigé avec succès",
        result: result.result,
      });
    } catch (error) {
      console.error("Erreur soumission quiz séquentiel:", error);
      res.status(500).json({
        error: "Erreur lors de la soumission du quiz séquentiel",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId/quiz/:quizId/correction - Récupère la correction d'un quiz
   */
  static async getQuizCorrection(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId, quizId } = req.params;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId || !quizId) {
        res.status(400).json({ error: "ID de séquence et quiz requis" });
        return;
      }

      // Récupération du quiz avec ses résultats (correction)
      const quiz = await QuizService.getQuiz(quizId, userId);

      if (!quiz.result) {
        res
          .status(404)
          .json({ error: "Correction non disponible pour ce quiz" });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          correction: quiz.result,
        },
      });
    } catch (error) {
      console.error("Erreur récupération correction:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération de la correction",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
}
