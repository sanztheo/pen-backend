import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { prisma } from "../../lib/prisma.js";
import type { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import SecureLogger from "../../middlewares/secureLogging.js";

/**
 * Configuration des plans Paddle
 * Les prix sont gérés dans le Paddle Dashboard
 */
export const PADDLE_PLANS = {
  free_user: {
    name: "Gratuit",
    paddlePriceId: null, // Pas de subscription Paddle pour le plan gratuit
  },
  premium: {
    name: "Premium",
    paddlePriceId: process.env.PADDLE_PREMIUM_PRICE_ID || "", // pri_xxxxx depuis Paddle Dashboard
  },
} as const;

/**
 * Client Paddle SDK initialisé avec les credentials
 */
export const paddle = new Paddle(process.env.PADDLE_API_KEY || "", {
  environment:
    process.env.PADDLE_ENVIRONMENT === "production"
      ? Environment.production
      : Environment.sandbox,
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
        console.log(`✅ [PADDLE] Abonnement gratuit créé pour ${userId}`);
      }

      return {
        ...subscription,
        planInfo: PADDLE_PLANS[subscription.plan],
        isActive: subscription.status === "active",
        isPremium: subscription.plan === "premium",
      };
    } catch (error) {
      console.error("❌ [PADDLE] Erreur récupération abonnement:", error);

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
        errorMessage:
          "Impossible de récupérer l'abonnement. Veuillez réessayer.",
      };
    }
  }

  /**
   * Active le plan Premium pour un utilisateur (appelé par le webhook)
   * @param userId - ID Clerk de l'utilisateur
   * @param paddleCustomerId - ID Customer Paddle
   * @param paddleSubscriptionId - ID Subscription Paddle
   * @param periodEnd - Date de fin de période
   */
  static async activatePremium(
    userId: string,
    paddleCustomerId: string,
    paddleSubscriptionId: string,
    periodEnd: Date,
  ) {
    try {
      console.log(`⬆️ [PADDLE] Activation Premium pour: ${userId}`);

      const subscription = await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan: "premium",
          status: "active",
          paddleCustomerId,
          paddleSubscriptionId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          canceledAt: null,
          cancelAtPeriodEnd: false,
        },
        create: {
          userId,
          plan: "premium",
          status: "active",
          paddleCustomerId,
          paddleSubscriptionId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        },
      });

      // Synchroniser les limites utilisateur
      await this.syncUserLimitsAfterPlanChange(userId, "premium");

      console.log(`✅ [PADDLE] Premium activé pour: ${userId}`);
      return subscription;
    } catch (error) {
      console.error("❌ [PADDLE] Erreur activation Premium:", error);
      throw error;
    }
  }

  /**
   * Annule l'abonnement d'un utilisateur (appelé par le webhook)
   * Note: L'accès reste actif jusqu'à currentPeriodEnd
   */
  static async cancelSubscription(userId: string, effectiveDate?: Date) {
    try {
      console.log(`🚫 [PADDLE] Annulation abonnement pour: ${userId}`);

      const subscription = await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          cancelAtPeriodEnd: true,
        },
      });

      console.log(`✅ [PADDLE] Abonnement marqué pour annulation: ${userId}`);
      return subscription;
    } catch (error) {
      console.error("❌ [PADDLE] Erreur annulation:", error);
      throw error;
    }
  }

  /**
   * Finalise l'annulation et remet l'utilisateur en plan gratuit
   * (appelé quand la période payée expire)
   */
  static async finalizeCancel(userId: string) {
    try {
      console.log(`🔄 [PADDLE] Finalisation annulation pour: ${userId}`);

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

      console.log(`✅ [PADDLE] Utilisateur remis en plan gratuit: ${userId}`);
      return subscription;
    } catch (error) {
      console.error("❌ [PADDLE] Erreur finalisation annulation:", error);
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
      console.error("❌ [PADDLE] Erreur mise à jour subscription:", error);
      throw error;
    }
  }

  /**
   * Synchronise les limites utilisateur après un changement de plan
   */
  static async syncUserLimitsAfterPlanChange(
    userId: string,
    newPlan: SubscriptionPlan,
  ) {
    try {
      SecureLogger.debug(
        `🔄 [PADDLE] Synchronisation limites après changement de plan`,
        { userId, newPlan },
      );

      // Calculer l'usage réel depuis la base de données
      const [
        workspacesCount,
        projectsCount,
        customQuizzesCount,
        presetSequencesCount,
        aiCreditsUsed,
      ] = await Promise.all([
        prisma.workspace.count({ where: { ownerId: userId } }),
        prisma.project.count({ where: { createdBy: userId } }),
        prisma.quiz.count({ where: { userId, preset: "NONE" } }),
        prisma.quizSequence.count({ where: { userId } }),
        prisma.usageRecord
          .aggregate({
            where: {
              userId,
              resourceType: { in: ["ai_credits", "openai_request"] },
            },
            _sum: { quantity: true },
          })
          .then((result) => result._sum.quantity || 0),
      ]);

      const isPremium = newPlan === "premium";

      // Synchroniser les limites avec l'usage réel et le nouveau plan
      const updatedLimits = await prisma.userLimits.upsert({
        where: { userId },
        update: {
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: -1,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
        },
        create: {
          userId,
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: -1,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
        },
      });

      SecureLogger.debug(`✅ [PADDLE] Limites synchronisées`, {
        userId,
        newPlan: isPremium ? "PREMIUM" : "FREE",
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
      console.error("❌ [PADDLE] Erreur récupération stats:", error);
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
      console.error("❌ [PADDLE] Erreur recherche par customerId:", error);
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
      console.error("❌ [PADDLE] Erreur recherche par subscriptionId:", error);
      return null;
    }
  }
}
