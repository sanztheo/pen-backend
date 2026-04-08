import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { prisma } from "../../lib/prisma.js";
import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { SecureLogger } from "../../middlewares/secureLogging.js";
import { logger } from "../../utils/logger.js";

/**
 * Configuration des plans Paddle
 * Les prix sont gérés dans le Paddle Dashboard
 */
import { PADDLE_CONFIG } from "../../config/paddle.js";

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
if (!PADDLE_API_KEY) throw new Error("Missing required env var: PADDLE_API_KEY");

export const PADDLE_PLANS = {
  free_user: {
    name: "Gratuit",
    paddlePriceId: null,
  },
  premium: {
    name: "Pro",
    paddlePriceId: PADDLE_CONFIG.prices.premiumMonthly,
  },
  ultra: {
    name: "Ultra",
    paddlePriceId: PADDLE_CONFIG.prices.ultraMonthly || null,
  },
} as const;

/** Re-export depuis la source unique de vérité */
import { PLAN_LIMITS } from "../../config/planLimits.js";
export { PLAN_LIMITS };

/**
 * Client Paddle SDK initialisé avec les credentials
 */
export const paddle = new Paddle(PADDLE_API_KEY, {
  environment:
    process.env.PADDLE_ENVIRONMENT === "production" ? Environment.production : Environment.sandbox,
});

/**
 * Service de gestion du billing via Paddle
 * Gère les subscriptions, upgrades, et synchronisation des limites
 */
export class PaddleBillingService {
  /**
   * Récupère l'abonnement d'un utilisateur depuis la DB locale
   */
  static async getUserSubscription(userId: string) {
    try {
      let subscription = await prisma.userSubscription.findUnique({
        where: { userId },
      });

      if (!subscription) {
        // Créer un abonnement gratuit par défaut
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        subscription = await prisma.userSubscription.upsert({
          where: { userId },
          create: {
            userId,
            plan: "free_user",
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          update: {},
        });
        logger.log(`✅ [PADDLE] Abonnement gratuit créé pour ${userId}`);
      }

      return {
        ...subscription,
        planInfo: PADDLE_PLANS[subscription.plan],
        isActive: subscription.status === "active",
        isPremium: subscription.plan === "premium" || subscription.plan === "ultra",
      };
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur récupération abonnement:", error);

      // 🛡️ SÉCURITÉ: Retourner un statut d'erreur détectable par le frontend
      // au lieu de silencieusement dégrader vers free_user
      return {
        userId,
        plan: "free_user" as SubscriptionPlan,
        status: "active" as SubscriptionStatus,
        planInfo: PADDLE_PLANS.free_user,
        isActive: true,
        isPremium: false,
        // 🚨 Indicateurs d'erreur pour le frontend
        isError: true,
        errorCode: "SUBSCRIPTION_FETCH_ERROR",
        errorMessage: "Impossible de récupérer l'abonnement. Veuillez réessayer.",
      };
    }
  }

  /**
   * Active le plan Premium pour un utilisateur (appelé par le webhook)
   * @param userId - ID Clerk de l'utilisateur
   * @param paddleCustomerId - ID Customer Paddle
   * @param paddleSubscriptionId - ID Subscription Paddle
   * @param periodEnd - Date de fin de période
   * @param trialDates - Optionnel: dates de trial si l'utilisateur est en période d'essai
   */
  static async activatePlan(
    userId: string,
    plan: "premium" | "ultra",
    paddleCustomerId: string,
    paddleSubscriptionId: string,
    periodEnd: Date,
    trialDates?: { trialStart: Date; trialEnd: Date },
  ) {
    try {
      // Validate trial dates if provided
      if (trialDates) {
        const { trialStart, trialEnd } = trialDates;
        if (!(trialStart instanceof Date) || isNaN(trialStart.getTime())) {
          logger.warn(`⚠️ [PADDLE] Invalid trialStart for user ${userId}, ignoring trial dates`);
          trialDates = undefined;
        } else if (!(trialEnd instanceof Date) || isNaN(trialEnd.getTime())) {
          logger.warn(`⚠️ [PADDLE] Invalid trialEnd for user ${userId}, ignoring trial dates`);
          trialDates = undefined;
        } else if (trialEnd <= trialStart) {
          logger.warn(
            `⚠️ [PADDLE] trialEnd <= trialStart for user ${userId}, ignoring trial dates`,
          );
          trialDates = undefined;
        }
      }

      const isTrial = !!trialDates;
      const status: SubscriptionStatus = isTrial ? "trialing" : "active";

      logger.log(
        `⬆️ [PADDLE] Activation ${plan} pour: ${userId} (${isTrial ? "TRIAL" : "ACTIVE"})`,
      );

      const subscription = await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan,
          status,
          paddleCustomerId,
          paddleSubscriptionId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          canceledAt: null,
          cancelAtPeriodEnd: false,
          // Set trial dates if provided
          ...(trialDates && {
            trialStart: trialDates.trialStart,
            trialEnd: trialDates.trialEnd,
          }),
        },
        create: {
          userId,
          plan,
          status,
          paddleCustomerId,
          paddleSubscriptionId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          // Set trial dates if provided
          ...(trialDates && {
            trialStart: trialDates.trialStart,
            trialEnd: trialDates.trialEnd,
          }),
        },
      });

      // Synchroniser les limites utilisateur
      await this.syncUserLimitsAfterPlanChange(userId, plan);

      logger.log(`✅ [PADDLE] ${plan} activé pour: ${userId} (status: ${status})`);
      return subscription;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur activation Premium:", error);
      throw error;
    }
  }

  /**
   * Annule l'abonnement d'un utilisateur (appelé par le webhook)
   * Note: L'accès reste actif jusqu'à currentPeriodEnd
   */
  static async cancelSubscription(userId: string, _effectiveDate?: Date) {
    try {
      logger.log(`🚫 [PADDLE] Annulation abonnement pour: ${userId}`);

      const subscription = await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          cancelAtPeriodEnd: true,
        },
      });

      logger.log(`✅ [PADDLE] Abonnement marqué pour annulation: ${userId}`);
      return subscription;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur annulation:", error);
      throw error;
    }
  }

  /**
   * Finalise l'annulation et remet l'utilisateur en plan gratuit
   * (appelé quand la période payée expire)
   */
  static async finalizeCancel(userId: string) {
    try {
      logger.log(`🔄 [PADDLE] Finalisation annulation pour: ${userId}`);

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const subscription = await prisma.userSubscription.update({
        where: { userId },
        data: {
          plan: "free_user",
          status: "active",
          paddleSubscriptionId: null,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        },
      });

      // Synchroniser les limites vers le plan gratuit
      await this.syncUserLimitsAfterPlanChange(userId, "free_user");

      logger.log(`✅ [PADDLE] Utilisateur remis en plan gratuit: ${userId}`);
      return subscription;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur finalisation annulation:", error);
      throw error;
    }
  }

  /**
   * Met à jour les informations de subscription (période, etc.)
   */
  static async updateSubscription(
    userId: string,
    data: {
      status?: SubscriptionStatus;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd?: boolean;
    },
  ) {
    try {
      const subscription = await prisma.userSubscription.update({
        where: { userId },
        data,
      });

      SecureLogger.debug(`🔄 [PADDLE] Subscription mise à jour`, {
        userId,
        ...data,
      });
      return subscription;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur mise à jour subscription:", error);
      throw error;
    }
  }

  /**
   * Synchronise les limites utilisateur après un changement de plan
   * IMPORTANT: Lors d'un downgrade, les compteurs sont remis à 0
   */
  static async syncUserLimitsAfterPlanChange(userId: string, newPlan: SubscriptionPlan) {
    try {
      SecureLogger.debug(`🔄 [PADDLE] Synchronisation limites après changement de plan`, {
        userId,
        newPlan,
      });

      const limits = PLAN_LIMITS[newPlan];

      // Vérifier si c'est un downgrade (ancien limit > nouveau limit)
      const currentLimits = await prisma.userLimits.findUnique({
        where: { userId },
        select: { aiCreditsLimit: true },
      });

      const isDowngrade =
        currentLimits &&
        currentLimits.aiCreditsLimit > limits.aiCreditsLimit &&
        limits.aiCreditsLimit !== -1;

      // Calculer l'usage des ressources permanentes (workspaces, projets)
      const [workspacesCount, projectsCount] = await Promise.all([
        prisma.workspace.count({ where: { ownerId: userId } }),
        prisma.project.count({ where: { createdBy: userId } }),
      ]);

      // Pour les compteurs mensuels:
      // - Si downgrade: reset à 0 (nouveau cycle commence)
      // - Sinon: garder les valeurs actuelles ou recalculer
      let aiCreditsUsedValue: number;
      let customQuizzesUsedValue: number;
      let presetSequencesUsedValue: number;
      let lastResetAtValue: Date | undefined;

      if (isDowngrade) {
        aiCreditsUsedValue = 0;
        customQuizzesUsedValue = 0;
        presetSequencesUsedValue = 0;
        lastResetAtValue = new Date();

        SecureLogger.log(`🔄 [PADDLE] Downgrade détecté - Reset des compteurs pour: ${userId}`);
      } else {
        const [customQuizzesCount, presetSequencesCount, aiCreditsAggregated] = await Promise.all([
          prisma.quiz.count({ where: { userId, preset: "NONE" } }),
          prisma.quizSequence.count({ where: { userId } }),
          (async () => {
            const result = await prisma.usageRecord.aggregate({
              where: {
                userId,
                resourceType: { in: ["ai_credits", "openai_request"] },
              },
              _sum: { quantity: true },
            });
            return result._sum.quantity || 0;
          })(),
        ]);

        aiCreditsUsedValue = Math.max(0, aiCreditsAggregated);
        customQuizzesUsedValue = customQuizzesCount;
        presetSequencesUsedValue = presetSequencesCount;
      }

      const updatedLimits = await prisma.userLimits.upsert({
        where: { userId },
        update: {
          aiCreditsLimit: limits.aiCreditsLimit,
          workspacesLimit: limits.workspacesLimit,
          projectsLimit: -1,
          customQuizzesLimit: limits.customQuizzesLimit,
          presetSequencesLimit: limits.presetSequencesLimit,
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesUsedValue,
          presetSequencesUsed: presetSequencesUsedValue,
          aiCreditsUsed: aiCreditsUsedValue,
          ...(lastResetAtValue && { lastResetAt: lastResetAtValue }),
        },
        create: {
          userId,
          aiCreditsLimit: limits.aiCreditsLimit,
          workspacesLimit: limits.workspacesLimit,
          projectsLimit: -1,
          customQuizzesLimit: limits.customQuizzesLimit,
          presetSequencesLimit: limits.presetSequencesLimit,
          aiCreditsUsed: aiCreditsUsedValue,
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesUsedValue,
          presetSequencesUsed: presetSequencesUsedValue,
          lastResetAt: lastResetAtValue || new Date(),
        },
      });

      SecureLogger.debug(`✅ [PADDLE] Limites synchronisées`, {
        userId,
        newPlan,
        isDowngrade,
        limits: {
          aiCredits: `${updatedLimits.aiCreditsUsed}/${updatedLimits.aiCreditsLimit === -1 ? "∞" : updatedLimits.aiCreditsLimit}`,
          workspaces: `${updatedLimits.workspacesUsed}/${updatedLimits.workspacesLimit === -1 ? "∞" : updatedLimits.workspacesLimit}`,
        },
      });

      return updatedLimits;
    } catch (error) {
      SecureLogger.error("❌ [PADDLE] Erreur synchronisation limites", error);
      throw error;
    }
  }

  /**
   * Récupère les statistiques de l'utilisateur
   */
  static async getUserStats(userId: string) {
    try {
      const subscription = await this.getUserSubscription(userId);

      return {
        subscription,
        isPremium: subscription.isPremium,
      };
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur récupération stats:", error);
      throw error;
    }
  }

  /**
   * Trouve un utilisateur par son ID customer Paddle
   */
  static async findUserByPaddleCustomerId(paddleCustomerId: string) {
    try {
      const subscription = await prisma.userSubscription.findFirst({
        where: { paddleCustomerId },
      });

      return subscription?.userId || null;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur recherche par customerId:", error);
      return null;
    }
  }

  /**
   * Trouve un utilisateur par son ID subscription Paddle
   */
  static async findUserByPaddleSubscriptionId(paddleSubscriptionId: string) {
    try {
      const subscription = await prisma.userSubscription.findFirst({
        where: { paddleSubscriptionId },
      });

      return subscription?.userId || null;
    } catch (error) {
      logger.error("❌ [PADDLE] Erreur recherche par subscriptionId:", error);
      return null;
    }
  }
}
