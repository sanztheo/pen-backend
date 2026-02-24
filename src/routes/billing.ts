import express from "express";
import { logger } from "../utils/logger.js";
import { PaddleBillingService, paddle } from "../services/billing/paddleBilling.js";
import { authenticateToken } from "../middlewares/auth.js";
import { validateEmail } from "../middlewares/validateEmail.js";
import { prisma } from "../lib/prisma.js";
import { PADDLE_CONFIG } from "../config/paddle.js";

const router = express.Router();

/**
 * GET /api/billing/subscription
 * Retourne l'abonnement actuel de l'utilisateur
 */
router.get("/subscription", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    const subscription = await PaddleBillingService.getUserSubscription(userId);

    res.json({
      success: true,
      subscription,
    });
  } catch (error) {
    logger.error("[API] Erreur recuperation abonnement:", error);
    res.status(500).json({
      error: "Erreur lors de la recuperation de l'abonnement",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * GET /api/billing/stats
 * Retourne les statistiques billing de l'utilisateur
 */
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    const subscription = await PaddleBillingService.getUserSubscription(userId);
    const isPremium = subscription.plan === "premium" && subscription.isActive;

    res.json({
      success: true,
      stats: {
        subscription,
        isPremium,
      },
    });
  } catch (error) {
    logger.error("[API] Erreur recuperation stats:", error);
    res.status(500).json({
      error: "Erreur lors de la recuperation des statistiques",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * POST /api/billing/checkout-session
 * Genere les informations necessaires pour ouvrir un checkout Paddle
 * Le checkout est ouvert cote frontend avec Paddle.js
 */
router.post("/checkout-session", authenticateToken, validateEmail, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    const { priceId, interval } = req.body;

    // Determiner le priceId si non fourni
    const selectedPriceId =
      priceId ||
      (interval === "yearly"
        ? PADDLE_CONFIG.prices.premiumYearly
        : PADDLE_CONFIG.prices.premiumMonthly);

    if (!selectedPriceId) {
      return res.status(400).json({ error: "Prix non configure" });
    }

    // Check if user already had a trial (trialStart not null)
    const existingSubscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { trialStart: true },
    });

    const hadTrial = existingSubscription?.trialStart !== null;

    logger.log(`[BILLING] Checkout session pour user ${userId}:`, {
      priceId: selectedPriceId,
      email: userEmail,
      hadTrial,
    });

    // Retourner les infos pour le checkout frontend
    // Le checkout sera ouvert avec Paddle.Checkout.open() cote client
    res.json({
      success: true,
      checkout: {
        priceId: selectedPriceId,
        customData: {
          clerkUserId: userId,
        },
        customer: {
          email: userEmail,
        },
      },
      hadTrial, // Inform frontend if user already had trial
    });
  } catch (error) {
    logger.error("[API] Erreur creation checkout session:", error);
    res.status(500).json({
      error: "Erreur lors de la creation de la session checkout",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * GET /api/billing/portal-url
 * Retourne l'URL du portail client Paddle pour gerer l'abonnement
 */
router.get("/portal-url", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    // Recuperer le paddleCustomerId de l'utilisateur
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: {
        paddleCustomerId: true,
        paddleSubscriptionId: true,
      },
    });

    if (!subscription?.paddleSubscriptionId) {
      return res.status(404).json({
        error: "Aucun abonnement Paddle trouve",
        message: "L'utilisateur n'a pas d'abonnement actif",
      });
    }

    // Generer l'URL de mise a jour du paiement via l'API Paddle
    try {
      const paddleSubscription = await paddle.subscriptions.get(subscription.paddleSubscriptionId);

      // L'URL de gestion est dans managementUrls
      const portalUrl =
        paddleSubscription.managementUrls?.updatePaymentMethod ||
        paddleSubscription.managementUrls?.cancel;

      if (!portalUrl) {
        return res.status(404).json({
          error: "URL du portail non disponible",
          message: "Impossible de generer l'URL de gestion",
        });
      }

      res.json({
        success: true,
        portalUrl,
        subscriptionId: subscription.paddleSubscriptionId,
      });
    } catch (paddleError: unknown) {
      logger.error("[API] Erreur API Paddle:", paddleError);
      return res.status(500).json({
        error: "Erreur lors de la recuperation du portail Paddle",
        details: paddleError instanceof Error ? paddleError.message : "Une erreur est survenue",
      });
    }
  } catch (error) {
    logger.error("[API] Erreur portal-url:", error);
    res.status(500).json({
      error: "Erreur lors de la recuperation de l'URL du portail",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * POST /api/billing/cancel
 * Annule l'abonnement Paddle de l'utilisateur
 */
router.post("/cancel", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    // Recuperer le paddleSubscriptionId
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { paddleSubscriptionId: true },
    });

    if (!subscription?.paddleSubscriptionId) {
      return res.status(404).json({
        error: "Aucun abonnement Paddle trouve",
      });
    }

    // Annuler via l'API Paddle (effective a la fin de la periode)
    await paddle.subscriptions.cancel(subscription.paddleSubscriptionId, {
      effectiveFrom: "next_billing_period",
    });

    // Marquer comme annule dans la DB
    await PaddleBillingService.cancelSubscription(userId);

    logger.log(`[BILLING] Abonnement annule pour user ${userId}`);

    res.json({
      success: true,
      message: "Abonnement annule. Actif jusqu'a la fin de la periode.",
    });
  } catch (error) {
    logger.error("[API] Erreur annulation:", error);
    res.status(500).json({
      error: "Erreur lors de l'annulation",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * POST /api/billing/upgrade
 * Retourne les informations de checkout pour upgrade
 * (Le paiement se fait cote frontend avec Paddle.js)
 */
router.post("/upgrade", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    // Verifier si deja premium
    const currentSub = await PaddleBillingService.getUserSubscription(userId);
    if (currentSub.isPremium) {
      return res.status(400).json({
        error: "Deja premium",
        message: "Vous avez deja un abonnement premium actif",
      });
    }

    // Retourner les infos pour ouvrir le checkout Paddle
    res.json({
      success: true,
      checkout: {
        priceId: PADDLE_CONFIG.prices.premiumMonthly,
        customData: {
          clerkUserId: userId,
        },
        customer: {
          email: userEmail,
        },
      },
    });
  } catch (error) {
    logger.error("[API] Erreur upgrade:", error);
    res.status(500).json({
      error: "Erreur lors de la preparation de l'upgrade",
      details: "Une erreur est survenue",
    });
  }
});

/**
 * GET /api/billing/prices
 * Retourne les prix configures (pour affichage frontend)
 */
router.get("/prices", async (_req, res) => {
  res.json({
    success: true,
    prices: {
      monthly: {
        id: PADDLE_CONFIG.prices.premiumMonthly,
        amount: 12,
        currency: "EUR",
        interval: "month",
      },
      yearly: {
        id: PADDLE_CONFIG.prices.premiumYearly,
        amount: 144,
        currency: "EUR",
        interval: "year",
      },
    },
    trial: PADDLE_CONFIG.trial,
  });
});

export { router as billingRouter };
