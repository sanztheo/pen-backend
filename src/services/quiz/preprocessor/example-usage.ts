/**
 * Example Usage - Quiz Limit Validator
 *
 * Ce fichier montre comment intégrer le preprocessor dans les contrôleurs de quiz.
 * NE PAS IMPORTER ce fichier - c'est uniquement pour documentation.
 */

import { Request, Response } from "express";
import { quizLimitValidator } from "./index.js";
import type { QuizPreprocessorOutput } from "./types.js";

// ============================================================================
// EXEMPLE 1: Validation après suggestions de l'IA
// ============================================================================

export async function createQuizWithValidation(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    // 1. L'agent IA génère des suggestions
    const aiSuggestions: QuizPreprocessorOutput = {
      recommendedQuestionCount: 40,
      questionTypes: ["MULTIPLE_CHOICE", "OPEN_QUESTION", "TRUE_FALSE"],
      difficulty: "medium",
      suggestedTimeLimit: 60,
      reasoning: "Based on content complexity and user level...",
    };

    // 2. Valider et corriger selon les limites utilisateur
    const validation = await quizLimitValidator.validateAndCorrect(
      aiSuggestions,
      userId,
    );

    // 3. Si corrections appliquées, informer l'utilisateur
    if (!validation.isValid) {
      return res.status(200).json({
        success: true,
        quizParams: validation.correctedOutput,
        warnings: validation.corrections.map((c) => ({
          field: c.field,
          message: c.reason,
        })),
        upgradePrompt: validation.upgradeRequired
          ? {
              title: "Passez à Premium",
              description:
                "Débloquez plus de questions et tous les types de questions",
              benefits: [
                "Jusqu'à 40 questions",
                "Questions ouvertes",
                "Quiz illimités",
              ],
            }
          : null,
      });
    }

    // 4. Utiliser les paramètres validés pour générer le quiz
    const quiz = await generateQuiz(validation.correctedOutput);

    res.json({ success: true, quiz });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

// ============================================================================
// EXEMPLE 2: Vérification avant de permettre la création
// ============================================================================

export async function checkQuizCreationAllowed(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const { questionCount, questionTypes } = req.body;

    // Vérifier si l'utilisateur peut créer ce quiz
    const canCreate = await quizLimitValidator.canCreateQuiz(
      userId,
      questionCount,
      questionTypes,
    );

    if (!canCreate.allowed) {
      return res.status(403).json({
        success: false,
        error: canCreate.reason,
        upgradeRequired: true,
        upgradeUrl: "/pricing",
      });
    }

    res.json({ success: true, allowed: true });
  } catch (error) {
    console.error("Error checking quiz creation:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

// ============================================================================
// EXEMPLE 3: Récupération des limites pour affichage frontend
// ============================================================================

export async function getUserQuizLimits(req: Request, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    // Récupérer le contexte utilisateur via le validator
    const context = await (quizLimitValidator as any).getUserContext(userId);
    const planLimits = quizLimitValidator.getLimitsForPlan(context.plan);

    res.json({
      success: true,
      plan: context.plan,
      limits: {
        maxQuestions: planLimits.maxQuestionsPerQuiz,
        allowedQuestionTypes: planLimits.allowedQuestionTypes,
        maxPages: planLimits.maxPagesSelection,
        monthlyQuizzes: {
          limit: context.currentLimits.customQuizzesLimit,
          used: context.currentLimits.customQuizzesUsed,
          remaining:
            context.currentLimits.customQuizzesLimit === -1
              ? "unlimited"
              : context.currentLimits.customQuizzesLimit -
                context.currentLimits.customQuizzesUsed,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching limits:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

// ============================================================================
// EXEMPLE 4: Middleware de validation pour routes de quiz
// ============================================================================

export async function validateQuizParams(
  req: Request,
  res: Response,
  next: Function,
) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non autorisé" });
    }

    const { questionCount, questionTypes } = req.body;

    // Valider les paramètres
    const canCreate = await quizLimitValidator.canCreateQuiz(
      userId,
      questionCount,
      questionTypes,
    );

    if (!canCreate.allowed) {
      return res.status(403).json({
        success: false,
        error: canCreate.reason,
        upgradeRequired: true,
      });
    }

    // Passer au contrôleur suivant
    next();
  } catch (error) {
    console.error("Validation error:", error);
    res.status(500).json({ error: "Erreur de validation" });
  }
}

// ============================================================================
// HELPER: Fonction fictive pour l'exemple
// ============================================================================

async function generateQuiz(params: QuizPreprocessorOutput) {
  // Logique de génération de quiz
  return {
    id: "quiz-123",
    questionCount: params.recommendedQuestionCount,
    difficulty: params.difficulty,
    questions: [],
  };
}
