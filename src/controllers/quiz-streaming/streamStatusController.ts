import { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../utils/logger.js";

export async function getStreamStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    const quizId = req.params.id;

    if (!userId) {
      res.status(401).json({ error: "Utilisateur non authentifié" });
      return;
    }

    if (!quizId) {
      res.status(400).json({ error: "ID du quiz requis" });
      return;
    }

    const quiz = await prisma.quiz.findFirst({
      where: {
        id: quizId,
        userId,
      },
    });

    if (!quiz) {
      res.status(404).json({ error: "Quiz non trouvé" });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: quiz.id,
        status: quiz.status || "ready",
        questionsGenerated: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
        isCompleted: quiz.status === "ready",
      },
    });
  } catch (error) {
    logger.error("Erreur vérification statut streaming:", error);
    res.status(500).json({
      error: "Erreur lors de la vérification du statut",
    });
  }
}
