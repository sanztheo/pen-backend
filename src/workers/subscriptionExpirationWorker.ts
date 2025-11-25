import { prisma } from "../lib/prisma.js";
import { deactivatePremiumPlan } from "../lib/billing-helpers.js";

/**
 * Worker qui vérifie et traite les abonnements expirés
 * À exécuter quotidiennement via cron
 */
export async function processExpiredSubscriptions() {
  try {
    console.log(
      "[Subscription Worker] Starting expired subscriptions check...",
    );

    const now = new Date();

    // Trouver toutes les subscriptions qui:
    // 1. Sont marquées pour annulation à la fin de période (cancelAtPeriodEnd = true)
    // 2. La date de prochain paiement est passée (nextPaymentDate < now)
    // 3. Le statut est encore "active" (pas encore désactivé)
    const expiredSubscriptions = await prisma.userSubscription.findMany({
      where: {
        cancelAtPeriodEnd: true,
        nextPaymentDate: {
          lt: now,
        },
        status: "active",
        plan: "premium", // Seulement les utilisateurs premium
      },
      select: {
        userId: true,
        nextPaymentDate: true,
        canceledAt: true,
      },
    });

    console.log(
      `[Subscription Worker] Found ${expiredSubscriptions.length} expired subscriptions to process`,
    );

    let successCount = 0;
    let errorCount = 0;

    // Traiter chaque subscription expirée
    for (const subscription of expiredSubscriptions) {
      try {
        console.log(
          `[Subscription Worker] Processing expired subscription for user: ${subscription.userId}`,
        );

        // Désactiver le plan premium et reset les limites
        await deactivatePremiumPlan(
          subscription.userId,
          "subscription_period_ended",
        );

        successCount++;
        console.log(
          `[Subscription Worker] ✅ Successfully downgraded user ${subscription.userId} to free plan`,
        );
      } catch (error) {
        errorCount++;
        console.error(
          `[Subscription Worker] ❌ Failed to process subscription for user ${subscription.userId}:`,
          error,
        );
      }
    }

    console.log(
      `[Subscription Worker] Completed. Success: ${successCount}, Errors: ${errorCount}`,
    );

    return {
      total: expiredSubscriptions.length,
      success: successCount,
      errors: errorCount,
    };
  } catch (error) {
    console.error(
      "[Subscription Worker] Fatal error during processing:",
      error,
    );
    throw error;
  }
}

/**
 * Fonction pour exécuter le worker manuellement (pour les tests)
 */
export async function runSubscriptionWorker() {
  console.log("[Subscription Worker] Manual execution started");
  const result = await processExpiredSubscriptions();
  console.log("[Subscription Worker] Manual execution completed:", result);
  return result;
}
