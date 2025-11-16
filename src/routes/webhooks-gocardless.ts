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

// Webhook secret pour vérifier la signature
const WEBHOOK_SECRET =
  process.env.GOCARDLESS_WEBHOOK_SECRET ||
  "3W8PRZirYFBzn_P1iWvxoVcg9v9dlqnAtCIcUErD";

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
 */
async function handlePaymentConfirmed(event: PaymentConfirmedEvent) {
  console.log(`[WEBHOOK] Traitement payment.confirmed: ${event.id}`);

  try {
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
        `[WEBHOOK] Utilisateur non trouvé pour customer: ${customerId}`,
      );
      return;
    }

    // Activer le plan premium
    await activatePremiumPlan(user.id, new Date(event.created_at));

    // Logger l'événement
    await logWebhookEvent("payments.confirmed", "completed", user.id, {
      eventId: event.id,
      paymentId: event.links.payment,
      customerId,
      createdAt: event.created_at,
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
 */
async function handleMandateCreated(event: MandateCreatedEvent) {
  console.log(`[WEBHOOK] Traitement mandates.created: ${event.id}`);

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

    // Récupérer le body raw pour vérification de signature
    const rawBody = req.body.toString("utf8");

    // Vérifier la signature
    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
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
