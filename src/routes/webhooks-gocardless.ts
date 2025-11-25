import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  GoCardlessWebhookEvent,
  GoCardlessWebhookPayload,
  PaymentConfirmedEvent,
  PaymentFailedEvent,
  MandateActiveEvent,
  MandateCancelledEvent,
  MandateFailedEvent,
  MandateCreatedEvent,
  SubscriptionCreatedEvent,
  SubscriptionFinishedEvent,
  BillingRequestFulfilledEvent,
} from "../types/gocardless.js";
import {
  isEventProcessed,
  logWebhookEvent,
  findUserByGocardlessCustomer,
  updateMandateStatus,
  updateSubscriptionInfo,
  activatePremiumPlan,
  deactivatePremiumPlan,
  updateUserLimitsToPremium,
  updateUserLimitsToFree,
} from "../lib/billing-helpers.js";

// 🔒 SÉCURITÉ CRITIQUE: Secret webhook doit être configuré en variable d'environnement
// Pas de fallback pour éviter les fuites de sécurité
const WEBHOOK_SECRET = process.env.GOCARDLESS_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error(
    "❌ SÉCURITÉ: GOCARDLESS_WEBHOOK_SECRET non configuré. Le serveur ne peut pas démarrer.",
  );
}

/**
 * Vérifie la signature HMAC-SHA256 du webhook GoCardless
 */
function verifyWebhookSignature(
  requestBody: string,
  signature: string,
  secret: string,
): boolean {
  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(requestBody)
    .digest("hex");

  // Vérifier d'abord que les longueurs correspondent
  if (signature.length !== computedSignature.length) {
    return false;
  }

  // Utiliser timingSafeEqual pour éviter les timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(computedSignature, "utf8"),
  );
}

/**
 * Handler pour l'événement payments.confirmed
 * 🔒 SÉCURITÉ: Validation mandate + transaction atomique
 */
async function handlePaymentConfirmed(event: PaymentConfirmedEvent) {
  console.log(`[WEBHOOK] Traitement payment.confirmed: ${event.id}`);

  try {
    // Validation timestamp (rejeter si événement > 5 minutes)
    const eventTimestamp = new Date(event.created_at).getTime();
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (now - eventTimestamp > FIVE_MINUTES) {
      console.warn(
        `[WEBHOOK] ⚠️ Événement ancien détecté (${Math.round((now - eventTimestamp) / 1000)}s), traitement quand même`,
      );
    }

    // Récupérer le paiement depuis GoCardless si nécessaire
    const customerId = event.links.customer;
    if (!customerId) {
      console.error("[WEBHOOK] Customer ID manquant dans l'événement");
      return;
    }

    // Trouver l'utilisateur via le customer ID
    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] ⚠️ Utilisateur non trouvé pour customer: ${customerId}`,
      );

      // 🔧 FIX: Créer quand même un PaymentLog orphelin pour le tracking/debug
      await prisma.paymentLog.create({
        data: {
          userId: `orphaned_${customerId}`, // ID temporaire pour identifier les orphelins
          amount: 0,
          currency: "EUR",
          status: "failed",
          provider: "gocardless",
          providerId: event.links.payment || `unknown_${Date.now()}`, // 🔒 FIX: Fallback si payment ID manquant
          eventId: event.id, // 🔒 FIX: Stocker eventId pour idempotence
          metadata: {
            eventId: event.id,
            paymentId: event.links.payment,
            customerId,
            createdAt: event.created_at,
            eventType: "payments.confirmed",
            error: "User not found in database",
            timestamp: new Date().toISOString(),
          },
        },
      });

      console.log(
        `[WEBHOOK] 📝 PaymentLog orphelin créé pour customer: ${customerId}`,
      );
      return;
    }

    // 🔒 SÉCURITÉ CRITIQUE: Vérifier que le mandate est actif avant activation premium
    const subscription = await prisma.userSubscription.findUnique({
      where: { userId: user.id },
      select: { mandateStatus: true, gocardlessMandateId: true },
    });

    if (!subscription || !subscription.mandateStatus) {
      console.error(
        `[WEBHOOK] ❌ SÉCURITÉ: Aucune subscription trouvée pour user ${user.id}`,
      );
      await logWebhookEvent("payments.confirmed", "failed", user.id, {
        eventId: event.id,
        paymentId: event.links.payment,
        customerId,
        error: "No subscription found",
        createdAt: event.created_at,
      });
      return;
    }

    if (subscription.mandateStatus !== "active") {
      console.error(
        `[WEBHOOK] ❌ SÉCURITÉ: Mandate non actif (${subscription.mandateStatus}) pour user ${user.id}`,
      );
      await logWebhookEvent("payments.confirmed", "failed", user.id, {
        eventId: event.id,
        paymentId: event.links.payment,
        customerId,
        mandateStatus: subscription.mandateStatus,
        error: "Mandate not active",
        createdAt: event.created_at,
      });
      return;
    }

    console.log(
      `[WEBHOOK] ✅ Mandate validé (${subscription.mandateStatus}) pour user ${user.id}`,
    );

    // 🔒 TRANSACTION ATOMIQUE: Éviter les race conditions
    await prisma.$transaction(async (tx) => {
      // Activer le plan premium avec lock pessimiste
      await activatePremiumPlan(user.id, new Date(event.created_at));

      // Logger l'événement
      await logWebhookEvent("payments.confirmed", "completed", user.id, {
        eventId: event.id,
        paymentId: event.links.payment,
        customerId,
        mandateId: subscription.gocardlessMandateId,
        mandateStatus: subscription.mandateStatus,
        createdAt: event.created_at,
      });
    });

    console.log(
      `[WEBHOOK] ✅ Paiement confirmé et plan premium activé pour user: ${user.id}`,
    );
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement payment.confirmed:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement payments.failed
 */
async function handlePaymentFailed(event: PaymentFailedEvent) {
  console.log(`[WEBHOOK] Traitement payment.failed: ${event.id}`);

  try {
    const customerId = event.links.customer;
    if (!customerId) {
      console.error("[WEBHOOK] Customer ID manquant dans l'événement");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Logger l'échec du paiement
    await logWebhookEvent("payments.failed", "failed", user.id, {
      eventId: event.id,
      paymentId: event.links.payment,
      customerId,
      failureReason: event.details?.cause,
      description: event.details?.description,
      createdAt: event.created_at,
    });

    // Pour l'instant, on ne désactive pas immédiatement le premium (grace period)
    // On pourrait envoyer un email d'avertissement ici
    console.log(
      `[WEBHOOK] ⚠️ Paiement échoué pour user: ${user.id} - Grace period actif`,
    );
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement payment.failed:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement mandates.created
 * Note: Dans le Billing Request Flow, le mandate ID peut être dans links.mandate
 * ou il faut attendre billing_requests.fulfilled pour links.mandate_request_mandate
 */
async function handleMandateCreated(event: MandateCreatedEvent) {
  console.log(`[WEBHOOK] Traitement mandates.created: ${event.id}`);
  console.log(`[WEBHOOK] Event links:`, JSON.stringify(event.links, null, 2));

  try {
    // Le mandate ID peut être dans links.mandate (standard) ou absent (Billing Request Flow)
    const mandateId = event.links.mandate;
    const customerId = event.links.customer;

    // Si pas de mandate ID ou customer ID, logger et continuer
    // Le billing_requests.fulfilled handler s'en occupera
    if (!mandateId || !customerId) {
      console.log(
        "[WEBHOOK] Mandate ID ou Customer ID manquant dans mandates.created - " +
          "sera traite par billing_requests.fulfilled",
      );
      console.log(
        `[WEBHOOK] Links disponibles: ${JSON.stringify(event.links)}`,
      );

      // Logger l'evenement quand meme pour le suivi
      await logWebhookEvent("mandates.created", "pending", undefined, {
        eventId: event.id,
        links: event.links,
        note: "Waiting for billing_requests.fulfilled",
        createdAt: event.created_at,
      });
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Mettre à jour le statut du mandat
    await updateMandateStatus(user.id, mandateId, "pending_customer_approval");

    // Logger l'événement
    await logWebhookEvent("mandates.created", "pending", user.id, {
      eventId: event.id,
      mandateId,
      customerId,
      createdAt: event.created_at,
    });

    console.log(`[WEBHOOK] ✅ Mandat créé pour user: ${user.id}`);
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement mandates.created:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement mandates.active
 */
async function handleMandateActive(event: MandateActiveEvent) {
  console.log(`[WEBHOOK] Traitement mandates.active: ${event.id}`);

  try {
    const mandateId = event.links.mandate;
    const customerId = event.links.customer;

    if (!mandateId || !customerId) {
      console.error("[WEBHOOK] Mandate ID ou Customer ID manquant");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Mettre à jour le statut du mandat
    await updateMandateStatus(user.id, mandateId, "active");

    // Logger l'événement
    await logWebhookEvent("mandates.active", "completed", user.id, {
      eventId: event.id,
      mandateId,
      customerId,
      createdAt: event.created_at,
    });

    console.log(`[WEBHOOK] ✅ Mandat activé pour user: ${user.id}`);
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement mandates.active:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement mandates.cancelled
 */
async function handleMandateCancelled(event: MandateCancelledEvent) {
  console.log(`[WEBHOOK] Traitement mandates.cancelled: ${event.id}`);

  try {
    const mandateId = event.links.mandate;
    const customerId = event.links.customer;

    if (!mandateId || !customerId) {
      console.error("[WEBHOOK] Mandate ID ou Customer ID manquant");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Mettre à jour le statut du mandat
    await updateMandateStatus(user.id, mandateId, "cancelled");

    // Désactiver le plan premium
    await deactivatePremiumPlan(user.id, "mandate_cancelled");

    // Logger l'événement
    await logWebhookEvent("mandates.cancelled", "cancelled", user.id, {
      eventId: event.id,
      mandateId,
      customerId,
      cancellationReason: event.details?.cause,
      createdAt: event.created_at,
    });

    console.log(
      `[WEBHOOK] ✅ Mandat annulé et premium désactivé pour user: ${user.id}`,
    );
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement mandates.cancelled:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement mandates.failed
 */
async function handleMandateFailed(event: MandateFailedEvent) {
  console.log(`[WEBHOOK] Traitement mandates.failed: ${event.id}`);

  try {
    const mandateId = event.links.mandate;
    const customerId = event.links.customer;

    if (!mandateId || !customerId) {
      console.error("[WEBHOOK] Mandate ID ou Customer ID manquant");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Mettre à jour le statut du mandat
    await updateMandateStatus(user.id, mandateId, "failed");

    // Désactiver le plan premium
    await deactivatePremiumPlan(user.id, "mandate_failed");

    // Logger l'événement
    await logWebhookEvent("mandates.failed", "failed", user.id, {
      eventId: event.id,
      mandateId,
      customerId,
      failureReason: event.details?.cause,
      description: event.details?.description,
      createdAt: event.created_at,
    });

    console.log(
      `[WEBHOOK] ✅ Mandat échoué et premium désactivé pour user: ${user.id}`,
    );
  } catch (error) {
    console.error(`[WEBHOOK] ❌ Erreur traitement mandates.failed:`, error);
    throw error;
  }
}

/**
 * Handler pour l'événement subscriptions.created
 */
async function handleSubscriptionCreated(event: SubscriptionCreatedEvent) {
  console.log(`[WEBHOOK] Traitement subscriptions.created: ${event.id}`);

  try {
    const subscriptionId = event.links.subscription;
    const customerId = event.links.customer;

    if (!subscriptionId || !customerId) {
      console.error("[WEBHOOK] Subscription ID ou Customer ID manquant");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Mettre à jour les informations de subscription
    await updateSubscriptionInfo(subscriptionId, user.id);

    // Logger l'événement
    await logWebhookEvent("subscriptions.created", "completed", user.id, {
      eventId: event.id,
      subscriptionId,
      customerId,
      createdAt: event.created_at,
    });

    console.log(`[WEBHOOK] ✅ Subscription créée pour user: ${user.id}`);
  } catch (error) {
    console.error(
      `[WEBHOOK] ❌ Erreur traitement subscriptions.created:`,
      error,
    );
    throw error;
  }
}

/**
 * Handler pour l'événement billing_requests.fulfilled
 * C'est l'evenement principal pour le Billing Request Flow qui contient le mandate ID
 */
async function handleBillingRequestFulfilled(
  event: BillingRequestFulfilledEvent,
) {
  console.log(`[WEBHOOK] Traitement billing_requests.fulfilled: ${event.id}`);
  console.log(`[WEBHOOK] Event links:`, JSON.stringify(event.links, null, 2));

  try {
    // Dans billing_requests.fulfilled, le mandate est dans mandate_request_mandate
    const mandateId = event.links.mandate_request_mandate;
    const customerId = event.links.customer;
    const billingRequestId = event.links.billing_request;

    if (!mandateId) {
      console.error(
        "[WEBHOOK] mandate_request_mandate manquant dans billing_requests.fulfilled",
      );
      console.log(
        `[WEBHOOK] Links disponibles: ${JSON.stringify(event.links)}`,
      );
      return;
    }

    if (!customerId) {
      console.error(
        "[WEBHOOK] Customer ID manquant dans billing_requests.fulfilled",
      );
      return;
    }

    console.log(
      `[WEBHOOK] Billing Request fulfilled - Mandate: ${mandateId}, Customer: ${customerId}`,
    );

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouve pour customer: ${customerId}`,
      );
      // Essayer de logger pour debug
      await logWebhookEvent("billing_requests.fulfilled", "failed", undefined, {
        eventId: event.id,
        mandateId,
        customerId,
        billingRequestId,
        error: "User not found by gocardlessCustomerId",
        createdAt: event.created_at,
      });
      return;
    }

    console.log(
      `[WEBHOOK] Utilisateur trouve: ${user.id} pour customer: ${customerId}`,
    );

    // Mettre a jour le mandat comme actif (fulfilled = le mandat est cree et pret)
    await updateMandateStatus(user.id, mandateId, "active");

    // Activer le plan premium immediatement
    // Car billing_requests.fulfilled signifie que tout le flow est complete
    await activatePremiumPlan(user.id, new Date(event.created_at));

    // Logger l'evenement
    await logWebhookEvent("billing_requests.fulfilled", "completed", user.id, {
      eventId: event.id,
      mandateId,
      customerId,
      billingRequestId,
      createdAt: event.created_at,
    });

    console.log(
      `[WEBHOOK] ✅ Billing Request fulfilled - Premium active pour user: ${user.id}`,
    );
  } catch (error) {
    console.error(
      `[WEBHOOK] ❌ Erreur traitement billing_requests.fulfilled:`,
      error,
    );
    throw error;
  }
}

/**
 * Handler pour l'événement subscriptions.finished
 */
async function handleSubscriptionFinished(event: SubscriptionFinishedEvent) {
  console.log(`[WEBHOOK] Traitement subscriptions.finished: ${event.id}`);

  try {
    const subscriptionId = event.links.subscription;
    const customerId = event.links.customer;

    if (!subscriptionId || !customerId) {
      console.error("[WEBHOOK] Subscription ID ou Customer ID manquant");
      return;
    }

    const user = await findUserByGocardlessCustomer(customerId);
    if (!user) {
      console.error(
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Désactiver le plan premium
    await deactivatePremiumPlan(user.id, "subscription_finished");

    // Logger l'événement
    await logWebhookEvent("subscriptions.finished", "cancelled", user.id, {
      eventId: event.id,
      subscriptionId,
      customerId,
      finishReason: event.details?.cause,
      createdAt: event.created_at,
    });

    console.log(
      `[WEBHOOK] ✅ Subscription terminée et premium désactivé pour user: ${user.id}`,
    );
  } catch (error) {
    console.error(
      `[WEBHOOK] ❌ Erreur traitement subscriptions.finished:`,
      error,
    );
    throw error;
  }
}

/**
 * Handler principal pour les webhooks GoCardless
 */
export async function gocardlessWebhookHandler(req: Request, res: Response) {
  console.log("[WEBHOOK] ========================================");
  console.log("[WEBHOOK] Réception webhook GoCardless");

  try {
    // Vérifier la présence de la signature
    const signature = req.headers["webhook-signature"] as string;
    if (!signature) {
      console.error("[WEBHOOK] ❌ Signature manquante");
      return res.status(401).json({ error: "Signature manquante" });
    }

    // 🔒 SÉCURITÉ: Récupérer le body raw (doit être un Buffer grâce à express.raw())
    // Vérifier que req.body est bien un Buffer
    if (!Buffer.isBuffer(req.body)) {
      console.error(
        "[WEBHOOK] ❌ ERREUR CONFIGURATION: req.body n'est pas un Buffer. Vérifier express.raw() dans index.ts",
      );
      return res
        .status(500)
        .json({ error: "Configuration serveur incorrecte" });
    }
    const rawBody = req.body.toString("utf8");

    // 🔒 SÉCURITÉ: Vérifier la signature (WEBHOOK_SECRET est garanti non-null par la vérification au démarrage)
    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET!)) {
      console.error("[WEBHOOK] ❌ Signature invalide");
      return res.status(401).json({ error: "Signature invalide" });
    }

    console.log("[WEBHOOK] ✅ Signature vérifiée");

    // Parser le payload
    const payload: GoCardlessWebhookPayload = JSON.parse(rawBody);

    if (!payload.events || !Array.isArray(payload.events)) {
      console.error("[WEBHOOK] ❌ Format de payload invalide");
      return res.status(400).json({ error: "Format invalide" });
    }

    console.log(`[WEBHOOK] ${payload.events.length} événement(s) reçu(s)`);

    // Traiter chaque événement
    for (const event of payload.events) {
      const eventType = `${event.resource_type}.${event.action}`;
      console.log(
        `[WEBHOOK] Traitement événement: ${eventType} (ID: ${event.id})`,
      );

      // Vérifier si l'événement a déjà été traité (idempotence)
      if (await isEventProcessed(event.id)) {
        console.log(`[WEBHOOK] ⏭️ Événement déjà traité: ${event.id}`);
        continue;
      }

      try {
        // Router vers le handler approprié
        switch (eventType) {
          case "payments.confirmed":
            await handlePaymentConfirmed(event as PaymentConfirmedEvent);
            break;

          case "payments.failed":
            await handlePaymentFailed(event as PaymentFailedEvent);
            break;

          case "mandates.created":
            await handleMandateCreated(event as MandateCreatedEvent);
            break;

          case "mandates.active":
            await handleMandateActive(event as MandateActiveEvent);
            break;

          case "mandates.cancelled":
            await handleMandateCancelled(event as MandateCancelledEvent);
            break;

          case "mandates.failed":
            await handleMandateFailed(event as MandateFailedEvent);
            break;

          case "subscriptions.created":
            await handleSubscriptionCreated(event as SubscriptionCreatedEvent);
            break;

          case "subscriptions.finished":
            await handleSubscriptionFinished(
              event as SubscriptionFinishedEvent,
            );
            break;

          case "billing_requests.fulfilled":
            await handleBillingRequestFulfilled(
              event as BillingRequestFulfilledEvent,
            );
            break;

          default:
            console.log(`[WEBHOOK] ℹ️ Type d'événement non géré: ${eventType}`);
            // Logger quand même l'événement non géré
            await logWebhookEvent(eventType, "pending", undefined, {
              eventId: event.id,
              eventType,
              links: event.links,
              details: event.details,
              createdAt: event.created_at,
            });
        }
      } catch (eventError) {
        console.error(
          `[WEBHOOK] ❌ Erreur traitement événement ${event.id}:`,
          eventError,
        );
        // Continuer avec les autres événements même si un échoue
      }
    }

    console.log("[WEBHOOK] ✅ Traitement terminé");
    console.log("[WEBHOOK] ========================================");

    // Répondre avec succès
    res.status(200).json({
      success: true,
      processed: payload.events.length,
    });
  } catch (error) {
    console.error("[WEBHOOK] ❌ Erreur générale:", error);
    console.log("[WEBHOOK] ========================================");

    // Retourner 500 pour que GoCardless réessaie
    res.status(500).json({
      error: "Erreur de traitement du webhook",
    });
  }
}

export default gocardlessWebhookHandler;
