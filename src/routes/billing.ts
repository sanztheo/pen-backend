import express from "express";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import { PaddleBillingService, paddle } from "../services/billing/paddleBilling.js";
import { authenticateToken, blockImpersonation } from "../middlewares/auth.js";
import { validateEmail } from "../middlewares/validateEmail.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { PADDLE_CONFIG, isPremiumPrice, isUltraPrice } from "../config/paddle.js";
import { withTimeout, PADDLE_TIMEOUT_MS } from "../utils/timeout.js";
import { billingRateLimit } from "../middlewares/rateLimiting.js";

const router = express.Router();

// Apply billing rate limit to all routes in this router
router.use(billingRateLimit);

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

    res.json({
      success: true,
      stats: {
        subscription,
        isPremium: subscription.isPremium && subscription.isActive,
        plan: subscription.plan,
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

    // Dedup: retourner la reponse cachee si double-click (30s TTL)
    const dedupKey = `billing:checkout:${userId}`;
    const cached = await redis.get(dedupKey);
    if (cached) {
      logger.log(`[BILLING] Checkout dedup hit pour user ${userId}`);
      return res.json(JSON.parse(cached));
    }

    const checkoutSchema = z.object({
      priceId: z.string().startsWith("pri_").optional(),
      interval: z.enum(["monthly", "yearly"]).optional(),
      plan: z.enum(["premium", "ultra"]).optional(),
    });

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Donnees de checkout invalides",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { priceId, interval, plan } = parsed.data;
    const targetPlan = plan ?? "premium";

    // Determine the priceId based on plan + interval
    let selectedPriceId: string;
    if (priceId) {
      selectedPriceId = priceId;
    } else if (targetPlan === "ultra") {
      selectedPriceId =
        interval === "yearly"
          ? PADDLE_CONFIG.prices.ultraYearly
          : PADDLE_CONFIG.prices.ultraMonthly;
    } else {
      selectedPriceId =
        interval === "yearly"
          ? PADDLE_CONFIG.prices.premiumYearly
          : PADDLE_CONFIG.prices.premiumMonthly;
    }

    if (!selectedPriceId) {
      return res.status(400).json({ error: "Prix non configure pour ce plan" });
    }

    // Validate that the priceId is a known Paddle price
    const knownPrices = [
      PADDLE_CONFIG.prices.premiumMonthly,
      PADDLE_CONFIG.prices.premiumYearly,
      PADDLE_CONFIG.prices.ultraMonthly,
      PADDLE_CONFIG.prices.ultraYearly,
    ].filter(Boolean);

    if (priceId && !knownPrices.includes(priceId)) {
      return res.status(400).json({ error: "Prix invalide" });
    }

    if (priceId) {
      const priceIsUltra = isUltraPrice(priceId);
      const priceIsPremium = isPremiumPrice(priceId);
      if (targetPlan === "ultra" && !priceIsUltra) {
        return res.status(400).json({ error: "Price does not match the requested plan" });
      }
      if (targetPlan === "premium" && !priceIsPremium) {
        return res.status(400).json({ error: "Price does not match the requested plan" });
      }
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
    const responseData = {
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
    };

    // Cache pour dedup (30s TTL)
    await redis.set(dedupKey, JSON.stringify(responseData), "EX", 30);

    res.json(responseData);
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
      const paddleSubscription = await withTimeout(
        paddle.subscriptions.get(subscription.paddleSubscriptionId),
        PADDLE_TIMEOUT_MS,
        "Paddle subscriptions.get",
      );

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
router.post("/cancel", authenticateToken, blockImpersonation, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    // Recuperer le paddleSubscriptionId + statut actuel
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { paddleSubscriptionId: true, cancelAtPeriodEnd: true, status: true },
    });

    if (!subscription?.paddleSubscriptionId) {
      return res.status(404).json({
        error: "Aucun abonnement Paddle trouve",
      });
    }

    // Idempotence: si deja annule ou en cours d'annulation, retourner succes
    if (subscription.cancelAtPeriodEnd || subscription.status === "canceled") {
      logger.log(`[BILLING] Annulation deja en cours pour user ${userId}, retour idempotent`);
      return res.json({
        success: true,
        message: "Abonnement annule. Actif jusqu'a la fin de la periode.",
      });
    }

    // Annuler via l'API Paddle (effective a la fin de la periode)
    await withTimeout(
      paddle.subscriptions.cancel(subscription.paddleSubscriptionId, {
        effectiveFrom: "next_billing_period",
      }),
      PADDLE_TIMEOUT_MS,
      "Paddle subscriptions.cancel",
    );

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
 * POST /api/billing/change-plan
 * Change le plan d'un abonné existant (Pro → Ultra ou Ultra → Pro)
 * via Paddle subscriptions.update() avec proration immédiate.
 */
router.post("/change-plan", authenticateToken, blockImpersonation, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Utilisateur non authentifie" });
    }

    const schema = z.object({
      targetPlan: z.enum(["premium", "ultra"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Plan cible invalide" });
    }
    const { targetPlan } = parsed.data;

    // Get current subscription
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId },
      select: { plan: true, paddleSubscriptionId: true, paddleCustomerId: true },
    });

    if (!subscription?.paddleSubscriptionId) {
      return res.status(400).json({ error: "Aucun abonnement actif" });
    }
    if (subscription.plan === targetPlan) {
      return res.status(400).json({ error: "Vous etes deja sur ce plan" });
    }
    if (subscription.plan === "free_user") {
      return res.status(400).json({ error: "Utilisez le checkout pour souscrire" });
    }

    // Determine the new price ID (monthly — Paddle keeps the billing cycle)
    const newPriceId =
      targetPlan === "ultra"
        ? PADDLE_CONFIG.prices.ultraMonthly
        : PADDLE_CONFIG.prices.premiumMonthly;

    if (!newPriceId) {
      return res.status(500).json({ error: "Prix non configure" });
    }

    logger.log(`[BILLING] Plan change: ${subscription.plan} → ${targetPlan} pour user ${userId}`);

    // Update subscription via Paddle API (prorated immediately)
    await withTimeout(
      paddle.subscriptions.update(subscription.paddleSubscriptionId, {
        items: [{ priceId: newPriceId, quantity: 1 }],
        prorationBillingMode: "prorated_immediately",
      }),
      PADDLE_TIMEOUT_MS,
      "Paddle subscriptions.update",
    );

    // The webhook will handle the actual plan change in DB
    // But we can optimistically update for faster UI feedback
    await PaddleBillingService.activatePlan(
      userId,
      targetPlan,
      subscription.paddleCustomerId ?? subscription.paddleSubscriptionId,
      subscription.paddleSubscriptionId,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );

    logger.log(`[BILLING] Plan change reussi: ${targetPlan} pour user ${userId}`);

    res.json({ success: true, newPlan: targetPlan });
  } catch (error) {
    logger.error("[API] Erreur change-plan:", error);
    res.status(500).json({
      error: "Erreur lors du changement de plan",
      details: error instanceof Error ? error.message : "Une erreur est survenue",
    });
  }
});

/**
 * GET /api/billing/prices
 * Retourne les prix configures (pour affichage frontend)
 */
router.get("/prices", authenticateToken, async (_req, res) => {
  res.json({
    success: true,
    prices: {
      premium: {
        monthly: {
          id: PADDLE_CONFIG.prices.premiumMonthly,
          amount: 13,
          currency: "EUR",
          interval: "month",
        },
        yearly: {
          id: PADDLE_CONFIG.prices.premiumYearly,
          amount: 109,
          currency: "EUR",
          interval: "year",
        },
      },
      ultra: {
        monthly: {
          id: PADDLE_CONFIG.prices.ultraMonthly,
          amount: 25,
          currency: "EUR",
          interval: "month",
        },
        yearly: {
          id: PADDLE_CONFIG.prices.ultraYearly,
          amount: 209,
          currency: "EUR",
          interval: "year",
        },
      },
    },
    trial: PADDLE_CONFIG.trial,
  });
});

export { router as billingRouter };
