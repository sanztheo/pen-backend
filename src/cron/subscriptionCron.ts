import cron from "node-cron";
import { processExpiredSubscriptions } from "../workers/subscriptionExpirationWorker.js";

/**
 * Cron job qui s'exécute tous les jours à 2h du matin
 * pour vérifier et traiter les abonnements expirés
 */
export function initSubscriptionExpirationCron() {
  // Exécuter tous les jours à 2h00 du matin
  const cronExpression = "0 2 * * *";

  console.log(
    "[Cron] Initializing subscription expiration cron job:",
    cronExpression,
  );

  cron.schedule(cronExpression, async () => {
    console.log("[Cron] Running daily subscription expiration check...");

    try {
      const result = await processExpiredSubscriptions();
      console.log("[Cron] Subscription expiration check completed:", result);
    } catch (error) {
      console.error(
        "[Cron] Error during subscription expiration check:",
        error,
      );
    }
  });

  console.log("[Cron] ✅ Subscription expiration cron job initialized");
}
