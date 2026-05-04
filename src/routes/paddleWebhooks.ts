import express from "express";
import { logger } from "../utils/logger.js";
import { paddle, PaddleBillingService } from "../services/billing/paddleBilling.js";
import { getPlanFromProductId } from "../config/paddle.js";
import { withTimeout, PADDLE_TIMEOUT_MS } from "../utils/timeout.js";
import { prisma } from "../lib/prisma.js";
import { EventName } from "@paddle/paddle-node-sdk";
import {
  extractCustomData,
  extractString,
  isSubscriptionEvent,
  isTransactionEvent,
} from "./paddleWebhookHelpers.js";

/**
 * 🏓 WEBHOOK PADDLE - BILLING
 *
 * Principe : Écouter et appliquer tous les événements Paddle Billing
 *
 * 💰 SUBSCRIPTION EVENTS:
 * - subscription.created → Subscription créée (attendre activated)
 * - subscription.activated → Plan activé, activer premium
 * - subscription.updated → Mise à jour période/items
 * - subscription.canceled → Annulé (actif jusqu'à fin période)
 * - subscription.paused → Plan en pause
 * - subscription.resumed → Plan repris après pause
 *
 * 💳 TRANSACTION EVENTS:
 * - transaction.completed → Paiement réussi
 * - transaction.payment_failed → Paiement échoué
 */

export const paddleWebhookHandler: express.RequestHandler = async (req, res) => {
  // Body previews leaked customer email/transaction data into logs — keep only
  // shape metadata (length, signature presence) and rely on event-level logs below.
  const isBuffer = Buffer.isBuffer(req.body);
  const bodyLength = isBuffer
    ? req.body.length
    : typeof req.body === "string"
      ? req.body.length
      : JSON.stringify(req.body).length;
  logger.log("🏓 [Paddle Webhook] received", {
    signaturePresent: Boolean(req.headers["paddle-signature"]),
    bodyLength,
    bodyIsBuffer: isBuffer,
  });

  try {
    const signature = req.headers["paddle-signature"] as string;
    const rawBody = (req.body as Buffer).toString("utf8");
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secretKey) {
      logger.error("[Paddle Webhook] ❌ PADDLE_WEBHOOK_SECRET manquant");
      return res.status(500).json({ error: "PADDLE_WEBHOOK_SECRET manquant" });
    }

    if (!signature) {
      logger.error("[Paddle Webhook] ❌ Header paddle-signature manquant");
      return res.status(400).json({ error: "Missing paddle-signature header" });
    }

    // 1️⃣ Vérifier la signature Paddle (ASYNC - nécessite await)
    let event: Awaited<ReturnType<typeof paddle.webhooks.unmarshal>>;
    try {
      event = await withTimeout(
        paddle.webhooks.unmarshal(rawBody, secretKey, signature),
        PADDLE_TIMEOUT_MS,
        "Paddle webhooks.unmarshal",
      );
      logger.log(`✅ [Paddle Webhook] Signature valide`);
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error("[Paddle Webhook] ❌ Signature invalide:", errorMessage);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const eventType = event.eventType;
    const eventId = event.eventId;
    const eventData = event.data;

    // 🔍 DEBUG: Log le type d'événement reçu
    logger.log(`📨 [Paddle Webhook] Type: ${eventType}, EventID: ${eventId}`);

    // 2️⃣ IDEMPOTENCE — pre-check only.
    // The marker (webhookEvent row) is inserted at the END of the handler, after
    // all real work succeeded. If the work throws, the catch returns 500 without
    // a marker, so Paddle retries hit a fresh handler. Pre-check below catches
    // genuine retries of an already-processed event.
    if (eventId) {
      const existing = await prisma.webhookEvent.findUnique({
        where: { eventId },
      });
      if (existing) {
        logger.log(`⏭️ [Paddle Webhook] Event déjà traité: ${eventType} - ${eventId}`);
        return res.status(200).json({ skipped: true, reason: "already_processed" });
      }
    }

    // Persist the idempotency marker — must be called from every success path,
    // BEFORE returning 200, AFTER the side-effects (activatePlan, etc.) ran.
    const recordProcessed = async (): Promise<void> => {
      if (!eventId) return;
      try {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      } catch (err: unknown) {
        // Concurrent retry won the race — already-processed marker exists. Safe to ignore.
        const isPrismaUniqueViolation =
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "P2002";
        if (!isPrismaUniqueViolation) throw err;
      }
      logger.log(`[PaddleWebhook] processed eventId=${eventId} type=${eventType}`);
    };

    // 3️⃣ Extraire le userId depuis customData
    // Le frontend doit passer { clerkUserId: "user_xxx" } lors du checkout
    const customData = extractCustomData(eventData);
    let userId: string | undefined | null = customData.clerkUserId ?? customData.clerk_user_id;

    // Si pas de customData, essayer de retrouver via paddleCustomerId
    const customerId = extractString(eventData, "customerId", "customer_id");
    if (!userId && customerId) {
      userId = await PaddleBillingService.findUserByPaddleCustomerId(customerId);
    }

    // Si pas de userId via customData, essayer via subscriptionId
    const dataId = extractString(eventData, "id");
    if (!userId && dataId) {
      userId = await PaddleBillingService.findUserByPaddleSubscriptionId(dataId);
    }

    // 4️⃣ TRAITER LES ÉVÉNEMENTS
    // Use type guards to safely access subscription/transaction data
    const subData = isSubscriptionEvent(event) ? event.data : undefined;
    const txnData = isTransactionEvent(event) ? event.data : undefined;

    // Extract product ID from subscription items to determine plan (premium vs ultra)
    // Only for subscription events — transaction events don't have items
    let activePlan: "premium" | "ultra" | undefined;
    const isActivationEvent =
      eventType === EventName.SubscriptionActivated || eventType === EventName.SubscriptionCreated;
    if (subData) {
      const itemsCount = subData.items?.length ?? 0;
      const subProductId = subData.items?.[0]?.price?.productId ?? "";

      // Activation events MUST carry items + a mapped product. Anything else is a payload
      // contract violation — throw so Paddle retries instead of silently leaving the user
      // on free_user (see PRE-MORTEM #2).
      if (isActivationEvent && itemsCount === 0) {
        throw new Error(`PADDLE_PAYLOAD_MISSING_ITEMS: eventId=${eventId} type=${eventType}`);
      }

      const subscribedPlan = getPlanFromProductId(subProductId);

      logger.log(`[WEBHOOK] Product ID extraction:`, {
        eventType,
        subProductId: subProductId || "(empty)",
        subscribedPlan,
        itemsCount,
      });

      if (subscribedPlan !== "free_user") {
        activePlan = subscribedPlan;
      } else if (subProductId) {
        // Product ID present but unrecognized.
        logger.error("[WEBHOOK] Unrecognized product ID", {
          productId: subProductId,
          eventType,
          eventId,
        });
        if (isActivationEvent) {
          throw new Error(
            `PADDLE_UNKNOWN_PRODUCT_ID: eventId=${eventId} productId=${subProductId}`,
          );
        }
      }
      // For non-activation events (subscription.updated/canceled/paused/resumed),
      // activePlan can stay undefined and individual handlers decide what to do.
    }

    // 📝 subscription.created - Subscription créée
    // 🎁 Si status "trialing" → Activer premium immédiatement pour le trial
    if (eventType === EventName.SubscriptionCreated) {
      const subscriptionStatus = subData?.status;
      const paddleCustomerId = subData?.customerId;
      const paddleSubscriptionId = subData?.id;

      logger.log(`📝 [Paddle Webhook] subscription.created:`, {
        subscriptionId: paddleSubscriptionId,
        customerId: paddleCustomerId,
        status: subscriptionStatus,
        customData,
      });

      // 🎁 TRIAL: Si status "trialing", activer le plan immédiatement
      if (
        subscriptionStatus === "trialing" &&
        userId &&
        paddleCustomerId &&
        paddleSubscriptionId &&
        activePlan
      ) {
        const trialStart = new Date();
        const trialEnd = subData?.currentBillingPeriod?.endsAt
          ? new Date(subData.currentBillingPeriod.endsAt)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours par défaut

        logger.log(`🎁 [Paddle Webhook] TRIAL ${activePlan} activé pour user ${userId}:`, {
          trialStart: trialStart.toISOString(),
          trialEnd: trialEnd.toISOString(),
          paddleCustomerId,
          paddleSubscriptionId,
        });

        await PaddleBillingService.activatePlan(
          userId,
          activePlan,
          paddleCustomerId,
          paddleSubscriptionId,
          trialEnd,
          { trialStart, trialEnd },
        );

        await recordProcessed();
        return res.status(200).json({ success: true, message: "trial_activated" });
      }

      // Si pas de trial ou pas de userId, juste logger
      await recordProcessed();
      return res.status(200).json({ success: true, message: "subscription_created_logged" });
    }

    // ✅ subscription.activated - Plan activé
    if (eventType === EventName.SubscriptionActivated) {
      if (!userId) {
        // Cannot resolve user — fail loudly so Paddle retries (likely a race with
        // user creation; transient).
        throw new Error(
          `PADDLE_ACTIVATED_NO_USER: eventId=${eventId} subscriptionId=${subData?.id ?? "?"}`,
        );
      }

      // activePlan is guaranteed defined here: missing items / unknown product
      // already threw above. Defensive check kept for type narrowing only.
      if (!activePlan) {
        throw new Error(`PADDLE_ACTIVATED_NO_PLAN: eventId=${eventId} userId=${userId}`);
      }

      const paddleCustomerId = subData?.customerId;
      const paddleSubscriptionId = subData?.id;

      if (!paddleCustomerId || !paddleSubscriptionId) {
        throw new Error(
          `PADDLE_ACTIVATED_MISSING_IDS: eventId=${eventId} customerId=${paddleCustomerId ?? "?"} subscriptionId=${paddleSubscriptionId ?? "?"}`,
        );
      }

      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      logger.log(`✅ [Paddle Webhook] subscription.activated:`, {
        userId,
        activePlan,
        paddleCustomerId,
        paddleSubscriptionId,
        status: subData?.status,
        currentPeriodEnd: currentPeriodEnd.toISOString(),
      });

      await PaddleBillingService.activatePlan(
        userId,
        activePlan,
        paddleCustomerId,
        paddleSubscriptionId,
        currentPeriodEnd,
      );

      await recordProcessed();
      return res.status(200).json({ success: true });
    }

    // 🔄 subscription.updated - Mise à jour subscription
    if (eventType === EventName.SubscriptionUpdated) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.updated sans userId`);
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const currentPeriodStart = subData?.currentBillingPeriod?.startsAt
        ? new Date(subData.currentBillingPeriod.startsAt)
        : undefined;
      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : undefined;
      const scheduledChange = subData?.scheduledChange;

      const updatedProductId = subData?.items?.[0]?.price?.productId ?? "";
      const updatedPlan = getPlanFromProductId(updatedProductId);

      logger.log(`🔄 [Paddle Webhook] subscription.updated:`, {
        userId,
        status: subData?.status,
        updatedProductId,
        updatedPlan,
        currentPeriodStart: currentPeriodStart?.toISOString(),
        currentPeriodEnd: currentPeriodEnd?.toISOString(),
        scheduledChange: scheduledChange
          ? {
              action: scheduledChange.action,
              effectiveAt: scheduledChange.effectiveAt,
            }
          : undefined,
      });

      const hasPendingCancel = scheduledChange?.action === "cancel";

      if (updatedPlan !== "free_user") {
        const paddleCustomerId = subData?.customerId;
        const paddleSubscriptionId = subData?.id;

        if (paddleCustomerId && paddleSubscriptionId) {
          const periodEnd = currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          await PaddleBillingService.activatePlan(
            userId,
            updatedPlan,
            paddleCustomerId,
            paddleSubscriptionId,
            periodEnd,
          );

          // Preserve cancel state if subscription has a scheduled cancellation
          // activatePlan resets cancelAtPeriodEnd — restore it here
          if (hasPendingCancel) {
            await PaddleBillingService.updateSubscription(userId, {
              cancelAtPeriodEnd: true,
            });
            logger.log(
              `🔄 [Paddle Webhook] Cancel state preserved after plan update for user ${userId}`,
            );
          }
        } else {
          await PaddleBillingService.updateSubscription(userId, {
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: hasPendingCancel,
          });
        }
      } else {
        await PaddleBillingService.updateSubscription(userId, {
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: hasPendingCancel,
        });
      }

      await recordProcessed();
      return res.status(200).json({ success: true });
    }

    // ⚠️ subscription.canceled - Annulé (mais actif jusqu'à fin période)
    if (eventType === EventName.SubscriptionCanceled) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.canceled sans userId`);
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const effectiveAt = subData?.scheduledChange?.effectiveAt
        ? new Date(subData.scheduledChange.effectiveAt)
        : undefined;

      logger.log(`⚠️ [Paddle Webhook] subscription.canceled:`, {
        userId,
        status: subData?.status,
        effectiveAt: effectiveAt?.toISOString(),
      });

      // Si le status est "canceled" (plus actif), remettre en free
      if (subData?.status === "canceled") {
        await PaddleBillingService.finalizeCancel(userId);
        logger.log(`✅ [Paddle Webhook] Utilisateur remis en free: ${userId}`);
      } else {
        // Sinon juste marquer comme annulé (actif jusqu'à fin période)
        await PaddleBillingService.cancelSubscription(userId, effectiveAt);
        logger.log(`✅ [Paddle Webhook] Subscription marquée pour annulation: ${userId}`);
      }

      await recordProcessed();
      return res.status(200).json({ success: true });
    }

    // ⏸️ subscription.paused - Plan en pause
    if (eventType === EventName.SubscriptionPaused) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.paused sans userId`);
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      logger.log(`⏸️ [Paddle Webhook] subscription.paused:`, { userId });

      // Mettre en pause = retour temporaire au free
      await PaddleBillingService.finalizeCancel(userId);

      await recordProcessed();
      return res.status(200).json({ success: true });
    }

    // ▶️ subscription.resumed - Plan repris
    if (eventType === EventName.SubscriptionResumed) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.resumed sans userId`);
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const paddleCustomerId = subData?.customerId;
      const paddleSubscriptionId = subData?.id;

      if (!paddleCustomerId || !paddleSubscriptionId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.resumed missing required fields:`, {
          paddleCustomerId,
          paddleSubscriptionId,
        });
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "missing_subscription_data" });
      }

      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      logger.log(`▶️ [Paddle Webhook] subscription.resumed:`, {
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
      });

      // Réactiver le plan
      if (!activePlan) {
        logger.error(`❌ [Paddle Webhook] subscription.resumed: could not determine plan`, {
          userId,
        });
        await recordProcessed();
        return res.status(200).json({ skipped: true, reason: "unknown_plan" });
      }

      await PaddleBillingService.activatePlan(
        userId,
        activePlan,
        paddleCustomerId,
        paddleSubscriptionId,
        currentPeriodEnd,
      );

      await recordProcessed();
      return res.status(200).json({ success: true });
    }

    // 💳 transaction.completed - Paiement réussi
    if (eventType === EventName.TransactionCompleted) {
      logger.log(`💳 [Paddle Webhook] transaction.completed:`, {
        transactionId: txnData?.id,
        subscriptionId: txnData?.subscriptionId,
        status: txnData?.status,
      });

      // Juste logger, la subscription.activated gère l'activation
      await recordProcessed();
      return res.status(200).json({ success: true, message: "payment_completed_logged" });
    }

    // ❌ transaction.payment_failed - Paiement échoué
    if (eventType === EventName.TransactionPaymentFailed) {
      const firstPayment = txnData?.payments?.[0];
      logger.log(`❌ [Paddle Webhook] transaction.payment_failed:`, {
        transactionId: txnData?.id,
        subscriptionId: txnData?.subscriptionId,
        errorCode: firstPayment?.errorCode,
      });

      // TODO: Envoyer email "Problème de paiement"

      await recordProcessed();
      return res.status(200).json({ success: true, message: "payment_failed_logged" });
    }

    // Si on arrive ici, événement non géré mais valide.
    logger.log(`⏭️ [Paddle Webhook] Event non géré: ${eventType}`);

    await recordProcessed();
    return res.status(200).json({ received: true, unhandled: eventType });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("[Paddle Webhook] ❌ Erreur:", errorMessage);
    return res.status(500).json({ error: "Webhook error" });
  }
};
