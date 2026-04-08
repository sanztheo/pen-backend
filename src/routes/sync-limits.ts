/**
 * 🔄 ROUTE DE SYNCHRONISATION DES LIMITES
 * Permet de synchroniser manuellement les limitations d'un utilisateur
 */

import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middlewares/auth.js";
import { SecureLogger } from "../middlewares/secureLogging.js";
import { PLAN_LIMITS } from "../config/planLimits.js";
import { normalizePlan } from "../utils/plans.js";

const router = Router();

/**
 * POST /api/sync-limits - Synchronise les limitations de l'utilisateur avec l'usage réel
 */
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "AUTHENTICATION_REQUIRED",
        message: "Authentification requise",
      });
    }

    SecureLogger.debug(`🔄 [SYNC-LIMITS] Synchronisation limites utilisateur`, {
      userId,
    });

    // Calculer l'usage réel + récupérer le plan en parallèle
    const [
      workspacesCount,
      projectsCount,
      customQuizzesCount,
      presetSequencesCount,
      aiCreditsUsed,
      subscription,
    ] = await Promise.all([
      prisma.workspace.count({ where: { ownerId: userId } }),
      prisma.project.count({ where: { createdBy: userId } }),
      prisma.quiz.count({ where: { userId, preset: "NONE" } }),
      prisma.quizSequence.count({ where: { userId } }),
      (async () => {
        const result = await prisma.usageRecord.aggregate({
          where: { userId, resourceType: "ai_action", action: "ai_deduction" },
          _sum: { quantity: true },
        });
        return result._sum.quantity || 0;
      })(),
      prisma.userSubscription.findUnique({ where: { userId } }),
    ]);

    const plan = normalizePlan(subscription?.plan);
    const limits = PLAN_LIMITS[plan];

    // Synchroniser les limites avec l'usage réel
    const updatedLimits = await prisma.userLimits.upsert({
      where: { userId },
      update: {
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: customQuizzesCount,
        presetSequencesUsed: presetSequencesCount,
        aiCreditsUsed: Math.max(0, aiCreditsUsed),
        aiCreditsLimit: limits.aiCreditsLimit,
        workspacesLimit: limits.workspacesLimit,
        projectsLimit: -1,
        customQuizzesLimit: limits.customQuizzesLimit,
        presetSequencesLimit: limits.presetSequencesLimit,
      },
      create: {
        userId,
        aiCreditsLimit: limits.aiCreditsLimit,
        workspacesLimit: limits.workspacesLimit,
        projectsLimit: -1,
        customQuizzesLimit: limits.customQuizzesLimit,
        presetSequencesLimit: limits.presetSequencesLimit,
        aiCreditsUsed: Math.max(0, aiCreditsUsed),
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: customQuizzesCount,
        presetSequencesUsed: presetSequencesCount,
      },
    });

    SecureLogger.debug(`✅ [SYNC-LIMITS] Limites synchronisées`, {
      userId,
      plan,
      usage: {
        workspaces: workspacesCount,
        projects: projectsCount,
        customQuizzes: customQuizzesCount,
        presetSequences: presetSequencesCount,
        aiCredits: aiCreditsUsed,
      },
    });

    res.status(200).json({
      success: true,
      message: "Limites synchronisées avec succès",
      data: {
        limits: {
          aiCreditsLimit: updatedLimits.aiCreditsLimit,
          workspacesLimit: updatedLimits.workspacesLimit,
          projectsLimit: updatedLimits.projectsLimit,
          customQuizzesLimit: updatedLimits.customQuizzesLimit,
          presetSequencesLimit: updatedLimits.presetSequencesLimit,
        },
        usage: {
          aiCreditsUsed: updatedLimits.aiCreditsUsed,
          workspacesUsed: updatedLimits.workspacesUsed,
          projectsUsed: updatedLimits.projectsUsed,
          customQuizzesUsed: updatedLimits.customQuizzesUsed,
          presetSequencesUsed: updatedLimits.presetSequencesUsed,
        },
        plan,
      },
    });
  } catch (error) {
    SecureLogger.error("❌ Erreur lors de la synchronisation des limites", error);
    res.status(500).json({
      success: false,
      error: "SYNC_LIMITS_ERROR",
      message: "Erreur lors de la synchronisation des limites",
    });
  }
});

export { router as sync_limitsRouter };
