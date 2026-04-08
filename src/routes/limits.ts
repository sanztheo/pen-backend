import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";
import { PLAN_LIMITS } from "../config/planLimits.js";
import type { SubscriptionPlan } from "@prisma/client";

const router = express.Router();

// GET /api/limits - Récupérer les limitations de l'utilisateur
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Non autorisé" });
    }

    // Récupérer les limitations de l'utilisateur avec la subscription
    let userLimits = await prisma.userLimits.findUnique({
      where: { userId },
    });

    // Récupérer la subscription pour avoir currentPeriodEnd
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
    });

    // Si l'utilisateur n'a pas encore de limitations, les créer avec les valeurs par défaut
    if (!userLimits) {
      const plan = (subscription?.plan ?? "free_user") as SubscriptionPlan;
      const limits = PLAN_LIMITS[plan];

      userLimits = await prisma.userLimits.upsert({
        where: { userId },
        update: {
          aiCreditsLimit: limits.aiCreditsLimit,
          workspacesLimit: limits.workspacesLimit,
          projectsLimit: -1,
          customQuizzesLimit: limits.customQuizzesLimit,
          presetSequencesLimit: limits.presetSequencesLimit,
          pagesSelectionLimit: limits.pagesSelectionLimit,
          questionsPerQuizLimit: limits.questionsPerQuizLimit,
        },
        create: {
          userId,
          aiCreditsLimit: limits.aiCreditsLimit,
          workspacesLimit: limits.workspacesLimit,
          projectsLimit: -1,
          customQuizzesLimit: limits.customQuizzesLimit,
          presetSequencesLimit: limits.presetSequencesLimit,
          pagesSelectionLimit: limits.pagesSelectionLimit,
          questionsPerQuizLimit: limits.questionsPerQuizLimit,
          advancedQuizzesLimit: limits.advancedQuizzesLimit,
          aiCreditsUsed: 0,
          workspacesUsed: 0,
          projectsUsed: 0,
          pagesUsed: 0,
          customQuizzesUsed: 0,
          presetSequencesUsed: 0,
          advancedQuizzesUsed: 0,
        },
      });
    }

    const plan = (subscription?.plan ?? "free_user") as SubscriptionPlan;

    res.json({
      success: true,
      limits: {
        ...userLimits,
        customAgentsLimit: PLAN_LIMITS[plan].customAgentsLimit,
      },
      nextResetDate: subscription?.currentPeriodEnd || null,
    });
  } catch (error) {
    logger.error("Erreur lors de la récupération des limitations:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// PUT /api/limits/sync - Synchroniser les limitations avec le plan actuel
router.put("/sync", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Non autorisé" });
    }

    // Récupérer le plan actuel
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
    });

    const plan = (subscription?.plan ?? "free_user") as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan];

    // Mettre à jour les limites selon le plan
    const userLimits = await prisma.userLimits.upsert({
      where: { userId },
      create: {
        userId,
        aiCreditsLimit: limits.aiCreditsLimit,
        workspacesLimit: limits.workspacesLimit,
        projectsLimit: -1,
        customQuizzesLimit: limits.customQuizzesLimit,
        presetSequencesLimit: limits.presetSequencesLimit,
        pagesSelectionLimit: limits.pagesSelectionLimit,
        questionsPerQuizLimit: limits.questionsPerQuizLimit,
        advancedQuizzesLimit: limits.advancedQuizzesLimit,
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        pagesUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
      },
      update: {
        aiCreditsLimit: limits.aiCreditsLimit,
        workspacesLimit: limits.workspacesLimit,
        projectsLimit: -1,
        customQuizzesLimit: limits.customQuizzesLimit,
        presetSequencesLimit: limits.presetSequencesLimit,
        pagesSelectionLimit: limits.pagesSelectionLimit,
        questionsPerQuizLimit: limits.questionsPerQuizLimit,
      },
    });

    res.json({ success: true, limits: userLimits });
  } catch (error) {
    logger.error("Erreur lors de la synchronisation des limitations:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// POST /api/limits/increment - 🚨 SÉCURITÉ: Endpoint désactivé
// Permet aux utilisateurs de manipuler leurs compteurs d'usage
router.post("/increment", authenticateToken, async (req, res) => {
  logger.error(`🚨 [SÉCURITÉ] Tentative d'increment non autorisée par: ${req.user?.id}`);
  return res.status(403).json({
    success: false,
    error: "Endpoint désactivé pour des raisons de sécurité",
    message: "La modification des compteurs d'usage est réservée aux opérations système internes",
  });
});

// POST /api/limits/decrement - 🚨 SÉCURITÉ: Endpoint désactivé
// Permet aux utilisateurs de réinitialiser leurs compteurs d'usage (bypass total des quotas)
router.post("/decrement", authenticateToken, async (req, res) => {
  logger.error(`🚨 [SÉCURITÉ] Tentative de decrement non autorisée par: ${req.user?.id}`);
  return res.status(403).json({
    success: false,
    error: "Endpoint désactivé pour des raisons de sécurité",
    message: "La modification des compteurs d'usage est réservée aux opérations système internes",
  });
});

// GET /api/limits/can-create/:type - Vérifier si l'utilisateur peut créer une ressource
router.get("/can-create/:type", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Non autorisé" });
    }

    const { type } = req.params;

    if (
      !["workspace", "project", "page", "customQuiz", "presetSequence", "aiCredit"].includes(type)
    ) {
      return res.status(400).json({ success: false, error: "Type de ressource invalide" });
    }

    // Récupérer les limitations
    const limits = await prisma.userLimits.findUnique({
      where: { userId },
    });

    if (!limits) {
      return res.status(404).json({ success: false, error: "Limitations non trouvées" });
    }

    // Vérifier si l'utilisateur peut créer
    let canCreate = false;

    switch (type) {
      case "workspace":
        canCreate = limits.workspacesLimit === -1 || limits.workspacesUsed < limits.workspacesLimit;
        break;
      case "project":
        canCreate = limits.projectsLimit === -1 || limits.projectsUsed < limits.projectsLimit;
        break;
      case "page":
        canCreate = limits.pagesLimit === -1 || limits.pagesUsed < limits.pagesLimit;
        break;
      case "customQuiz":
        canCreate =
          limits.customQuizzesLimit === -1 || limits.customQuizzesUsed < limits.customQuizzesLimit;
        break;
      case "presetSequence":
        canCreate =
          limits.presetSequencesLimit === -1 ||
          limits.presetSequencesUsed < limits.presetSequencesLimit;
        break;
      case "aiCredit":
        canCreate = limits.aiCreditsLimit === -1 || limits.aiCreditsUsed < limits.aiCreditsLimit;
        break;
    }

    res.json({ success: true, canCreate, limits });
  } catch (error) {
    logger.error("Erreur lors de la vérification des limites:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

export { router as limitsRouter };
