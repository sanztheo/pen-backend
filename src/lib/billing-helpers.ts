import { prisma } from "./prisma.js";

/**
 * Met à jour les limites d'un utilisateur vers le plan Premium
 * @param userId - L'ID de l'utilisateur à mettre à jour
 */
export async function updateUserLimitsToPremium(userId: string) {
  try {
    console.log(
      `[BILLING] Mise à jour des limites vers PREMIUM pour user: ${userId}`,
    );

    // Mettre à jour les limites dans UserLimits (illimité = -1)
    await prisma.userLimits.upsert({
      where: { userId },
      update: {
        aiCreditsLimit: -1,
        workspacesLimit: -1,
        projectsLimit: -1,
        customQuizzesLimit: -1,
        presetSequencesLimit: -1,
        historyQuizzesLimit: -1,
        pagesSelectionLimit: -1,
        questionsPerQuizLimit: -1,
        advancedQuizzesLimit: -1,
        statsChartsLimit: [], // Tous les graphiques disponibles
      },
      create: {
        userId,
        aiCreditsLimit: -1,
        workspacesLimit: -1,
        projectsLimit: -1,
        customQuizzesLimit: -1,
        presetSequencesLimit: -1,
        historyQuizzesLimit: -1,
        pagesSelectionLimit: -1,
        questionsPerQuizLimit: -1,
        advancedQuizzesLimit: -1,
        statsChartsLimit: [],
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
      },
    });

    console.log(`[BILLING] ✅ Limites PREMIUM appliquées pour user: ${userId}`);
  } catch (error) {
    console.error(
      `[BILLING] ❌ Erreur lors de la mise à jour vers Premium:`,
      error,
    );
    throw error;
  }
}

/**
 * Met à jour les limites d'un utilisateur vers le plan Free
 * @param userId - L'ID de l'utilisateur à mettre à jour
 */
export async function updateUserLimitsToFree(userId: string) {
  try {
    console.log(
      `[BILLING] Mise à jour des limites vers FREE pour user: ${userId}`,
    );

    // Mettre à jour les limites dans UserLimits vers les valeurs free
    await prisma.userLimits.upsert({
      where: { userId },
      update: {
        aiCreditsLimit: 50,
        workspacesLimit: 2,
        projectsLimit: -1, // Illimité pour projets même en free
        customQuizzesLimit: 5,
        presetSequencesLimit: 1,
        historyQuizzesLimit: 5,
        pagesSelectionLimit: 2,
        questionsPerQuizLimit: 10,
        advancedQuizzesLimit: 10,
        statsChartsLimit: ["progression-area", "difficulty-radar"],
        // Reset les usages
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
        lastResetAt: new Date(),
      },
      create: {
        userId,
        aiCreditsLimit: 50,
        workspacesLimit: 2,
        projectsLimit: -1,
        customQuizzesLimit: 5,
        presetSequencesLimit: 1,
        historyQuizzesLimit: 5,
        pagesSelectionLimit: 2,
        questionsPerQuizLimit: 10,
        advancedQuizzesLimit: 10,
        statsChartsLimit: ["progression-area", "difficulty-radar"],
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
        lastResetAt: new Date(),
      },
    });

    console.log(`[BILLING] ✅ Limites FREE appliquées pour user: ${userId}`);
  } catch (error) {
    console.error(
      `[BILLING] ❌ Erreur lors de la mise à jour vers Free:`,
      error,
    );
    throw error;
  }
}

/**
 * Calcule la date du prochain paiement (1 mois après la date donnée)
 * @param fromDate - Date de référence
 * @returns La date du prochain paiement
 */
export function calculateNextPaymentDate(fromDate: Date = new Date()): Date {
  const nextDate = new Date(fromDate);
  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
}

/**
 * Vérifie si un événement a déjà été traité (idempotence)
 * 🔒 SÉCURITÉ: Utilise la colonne eventId unique pour idempotence
 * @param eventId - L'ID de l'événement GoCardless
 * @returns true si l'événement a déjà été traité
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  try {
    // 🔒 FIX: Utiliser la colonne eventId unique au lieu de chercher dans metadata
    const existingLog = await prisma.paymentLog.findUnique({
      where: {
        eventId: eventId,
      },
      select: { id: true },
    });

    return !!existingLog;
  } catch (error) {
    console.error(
      `[BILLING] Erreur lors de la vérification de l'événement:`,
      error,
    );
    return false;
  }
}

/**
 * Enregistre un événement webhook dans PaymentLog
 * 🔒 SÉCURITÉ: Utilise la colonne eventId pour idempotence
 * @param eventType - Type d'événement (ex: "payments.confirmed")
 * @param status - Status du paiement
 * @param userId - ID de l'utilisateur (optionnel)
 * @param metadata - Données additionnelles
 */
export async function logWebhookEvent(
  eventType: string,
  status: "pending" | "completed" | "failed" | "cancelled",
  userId?: string,
  metadata: Record<string, any> = {},
) {
  try {
    // Ne créer le log que si on a un userId valide
    if (userId) {
      await prisma.paymentLog.create({
        data: {
          userId,
          amount: metadata.amount || 0,
          currency: metadata.currency || "EUR",
          status,
          provider: "gocardless",
          providerId:
            metadata.paymentId ||
            metadata.mandateId ||
            metadata.eventId ||
            `webhook_${Date.now()}`,
          eventId: metadata.eventId || null, // 🔒 FIX: Stocker eventId dans colonne dédiée
          metadata: {
            ...metadata,
            eventType,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } else {
      // Logger dans la console si pas d'userId
      console.log(`[BILLING] Événement sans userId: ${eventType}`, metadata);
    }

    console.log(`[BILLING] ✅ Événement webhook enregistré: ${eventType}`);
  } catch (error) {
    console.error(
      `[BILLING] ❌ Erreur lors de l'enregistrement de l'événement:`,
      error,
    );
  }
}

/**
 * Trouve un utilisateur par son ID customer GoCardless
 * @param gocardlessCustomerId - L'ID customer GoCardless
 * @returns L'utilisateur trouvé ou null
 */
export async function findUserByGocardlessCustomer(
  gocardlessCustomerId: string,
) {
  try {
    const subscription = await prisma.userSubscription.findFirst({
      where: { gocardlessCustomerId },
      include: { user: true },
    });

    return subscription?.user || null;
  } catch (error) {
    console.error(
      `[BILLING] Erreur lors de la recherche de l'utilisateur:`,
      error,
    );
    return null;
  }
}

/**
 * Met à jour le statut d'un mandat
 * 🔒 SÉCURITÉ: Mise à jour cohérente du status subscription
 * @param mandateId - L'ID du mandat GoCardless
 * @param mandateStatus - Le nouveau statut du mandat
 * @param reference - La référence du mandat (optionnel)
 */
export async function updateMandateStatus(
  userId: string,
  mandateId: string,
  mandateStatus:
    | "pending_customer_approval"
    | "pending_submission"
    | "submitted"
    | "active"
    | "failed"
    | "cancelled"
    | "expired",
  reference?: string,
) {
  try {
    const updateData: any = {
      gocardlessMandateId: mandateId,
      mandateStatus: mandateStatus,
    };

    // 🔒 FIX: Mettre à jour le status de la subscription selon le statut du mandat
    // MAIS ne pas toucher au status si cancelAtPeriodEnd est true (l'utilisateur reste premium jusqu'à expiration)
    if (mandateStatus === "active") {
      updateData.status = "active";
    } else if (mandateStatus === "failed" || mandateStatus === "expired") {
      // Échecs et expirations → désactivation immédiate
      updateData.status = "canceled";
    }
    // NOTE: mandateStatus === "cancelled" ne change PAS le status ici
    // Car l'utilisateur peut avoir annulé volontairement et doit rester premium jusqu'à nextPaymentDate

    if (reference) {
      updateData.mandateReference = reference;
    }

    // 🔧 FIX: Récupérer le gocardlessCustomerId du user pour éviter de créer avec un ID vide
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { gocardlessCustomerId: true },
    });

    // Upsert pour créer si n'existe pas, ou mettre à jour si existe
    await prisma.userSubscription.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        plan: "free_user",
        status: "active", // 🔒 FIX: Status par défaut lors de la création
        gocardlessCustomerId: user?.gocardlessCustomerId || "", // ✅ Utilise le customer ID du user
        ...updateData,
      },
    });

    console.log(
      `[BILLING] ✅ Statut du mandat ${mandateId} mis à jour: ${mandateStatus} (subscription status: ${updateData.status || "unchanged"})`,
    );
  } catch (error) {
    console.error(`[BILLING] Erreur lors de la mise à jour du mandat:`, error);
    throw error;
  }
}

/**
 * Met à jour les informations de subscription
 * @param subscriptionId - L'ID de la subscription GoCardless
 * @param userId - L'ID de l'utilisateur
 */
export async function updateSubscriptionInfo(
  subscriptionId: string,
  userId: string,
) {
  try {
    await prisma.userSubscription.update({
      where: { userId },
      data: {
        gocardlessSubscriptionId: subscriptionId,
        updatedAt: new Date(),
      },
    });

    console.log(
      `[BILLING] ✅ Subscription ${subscriptionId} associée à l'utilisateur ${userId}`,
    );
  } catch (error) {
    console.error(
      `[BILLING] Erreur lors de la mise à jour de la subscription:`,
      error,
    );
    throw error;
  }
}

/**
 * Active le plan premium suite à un paiement confirmé
 * 🔒 SÉCURITÉ: Mise à jour cohérente du status + plan
 * @param userId - L'ID de l'utilisateur
 * @param paymentDate - Date du paiement
 */
export async function activatePremiumPlan(
  userId: string,
  paymentDate: Date = new Date(),
) {
  try {
    const nextPaymentDate = calculateNextPaymentDate(paymentDate);

    // 🔒 FIX CRITIQUE: Toujours mettre à jour status + plan + paymentMethod ensemble
    await prisma.userSubscription.update({
      where: { userId },
      data: {
        plan: "premium",
        status: "active", // 🔒 FIX: Ajouter le status pour cohérence DB
        paymentMethod: "gocardless", // 🔒 FIX: Assurer que paymentMethod est toujours défini
        lastPaymentDate: paymentDate,
        nextPaymentDate,
        updatedAt: new Date(),
      },
    });

    await updateUserLimitsToPremium(userId);

    console.log(
      `[BILLING] ✅ Plan premium activé (status: active) pour user ${userId}, prochain paiement: ${nextPaymentDate.toISOString()}`,
    );
  } catch (error) {
    console.error(
      `[BILLING] Erreur lors de l'activation du plan premium:`,
      error,
    );
    throw error;
  }
}

/**
 * Désactive le plan premium et retour au plan free
 * 🔒 SÉCURITÉ: Mise à jour cohérente du status + plan
 * @param userId - L'ID de l'utilisateur
 * @param reason - Raison de la désactivation
 */
export async function deactivatePremiumPlan(
  userId: string,
  reason: string = "unknown",
) {
  try {
    // 🔒 FIX CRITIQUE: Mettre à jour status à "canceled" lors de la désactivation
    await prisma.userSubscription.update({
      where: { userId },
      data: {
        plan: "free_user",
        status: "canceled", // 🔒 FIX: Ajouter le status pour cohérence DB
        cancelAtPeriodEnd: false, // 🔒 FIX: Reset car la période est terminée
        canceledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await updateUserLimitsToFree(userId);

    console.log(
      `[BILLING] ✅ Plan premium désactivé (status: canceled) pour user ${userId}, raison: ${reason}`,
    );
  } catch (error) {
    console.error(
      `[BILLING] Erreur lors de la désactivation du plan premium:`,
      error,
    );
    throw error;
  }
}
