/**
 * 🔄 ROUTE DE SYNCHRONISATION DES LIMITES
 * Permet de synchroniser manuellement les limitations d'un utilisateur
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import SecureLogger from '../middlewares/secureLogging.js';

const router = Router();

/**
 * POST /api/sync-limits - Synchronise les limitations de l'utilisateur avec l'usage réel
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentification requise'
      });
    }

    SecureLogger.debug(`🔄 [SYNC-LIMITS] Synchronisation limites utilisateur`, { userId });

    // Calculer l'usage réel depuis la base de données
    const [workspacesCount, projectsCount, customQuizzesCount, presetSequencesCount, aiCreditsUsed] = await Promise.all([
      prisma.workspace.count({ where: { ownerId: userId } }),
      prisma.project.count({ where: { createdBy: userId } }),
      prisma.quiz.count({ where: { userId, preset: 'NONE' } }),
      prisma.quizSequence.count({ where: { userId } }),
      prisma.usageRecord.aggregate({
        where: { userId, resourceType: { in: ['ai_credits', 'openai_request'] } },
        _sum: { quantity: true }
      }).then(result => result._sum.quantity || 0)
    ]);

    // Récupérer l'abonnement actuel pour déterminer les limites
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId }
    });

    const isPremium = subscription?.plan === 'premium';

    // Synchroniser les limites avec l'usage réel
    const updatedLimits = await prisma.userLimits.upsert({
      where: { userId },
      update: {
        // Synchroniser l'usage avec les données réelles
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: customQuizzesCount,
        presetSequencesUsed: presetSequencesCount,
        aiCreditsUsed: Math.max(0, aiCreditsUsed),
        // Mettre à jour les limites selon le plan (au cas où)
        aiCreditsLimit: isPremium ? -1 : 50,
        workspacesLimit: isPremium ? -1 : 2,
        projectsLimit: isPremium ? -1 : 4,
        customQuizzesLimit: isPremium ? -1 : 5,
        presetSequencesLimit: isPremium ? -1 : 1,
      },
      create: {
        userId,
        // Limites selon le plan
        aiCreditsLimit: isPremium ? -1 : 50,
        workspacesLimit: isPremium ? -1 : 2,
        projectsLimit: isPremium ? -1 : 4,
        customQuizzesLimit: isPremium ? -1 : 5,
        presetSequencesLimit: isPremium ? -1 : 1,
        // Usage synchronisé avec la réalité
        aiCreditsUsed: Math.max(0, aiCreditsUsed),
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: customQuizzesCount,
        presetSequencesUsed: presetSequencesCount,
      }
    });

    SecureLogger.debug(`✅ [SYNC-LIMITS] Limites synchronisées`, { 
      userId, 
      plan: isPremium ? 'PREMIUM' : 'FREE',
      usage: {
        workspaces: workspacesCount,
        projects: projectsCount,
        customQuizzes: customQuizzesCount,
        presetSequences: presetSequencesCount,
        aiCredits: aiCreditsUsed
      }
    });

    res.status(200).json({
      success: true,
      message: 'Limites synchronisées avec succès',
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
        plan: isPremium ? 'premium' : 'free'
      }
    });

  } catch (error) {
    SecureLogger.error('❌ Erreur lors de la synchronisation des limites', error);
    res.status(500).json({
      success: false,
      error: 'SYNC_LIMITS_ERROR',
      message: 'Erreur lors de la synchronisation des limites'
    });
  }
});

export default router;