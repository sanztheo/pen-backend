import express from "express";
import { logger } from "../utils/logger.js";
import {
  paddle,
  PaddleBillingService,
} from "../services/billing/paddleBilling.js";
import { prisma } from "../lib/prisma.js";
import {
  EventName,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";

/**
 * Custom data passed through Paddle checkout for user identification
 */
interface PaddleCustomData {
  clerkUserId?: string;
  clerk_user_id?: string;
}

/**
 * Type guard to check if event has subscription data
 */
function isSubscriptionEvent(event: {
  eventType: string;
  data: unknown;
}): event is { eventType: string; data: SubscriptionNotification } {
  return (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("subscription.") &&
    event.data !== null &&
    typeof event.data === "object"
  );
}

/**
 * Type guard to check if event has transaction data
 */
function isTransactionEvent(event: {
  eventType: string;
  data: unknown;
}): event is { eventType: string; data: TransactionNotification } {
  return (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("transaction.") &&
    event.data !== null &&
    typeof event.data === "object"
  );
}

/**
 * Safely extract custom data from subscription/transaction data
 */
function extractCustomData(data: unknown): PaddleCustomData {
  if (data === null || typeof data !== "object") {
    return {};
  }
  const typedData = data as Record<string, unknown>;
  const customData = typedData.customData ?? typedData.custom_data;
  if (customData === null || typeof customData !== "object") {
    return {};
  }
  return customData as PaddleCustomData;
}

/**
 * Safely extract string property from unknown data
 */
function extractString(
  data: unknown,
  key: string,
  fallbackKey?: string,
): string | undefined {
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const typedData = data as Record<string, unknown>;
  const value =
    typedData[key] ?? (fallbackKey ? typedData[fallbackKey] : undefined);
  return typeof value === "string" ? value : undefined;
}

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

export const paddleWebhookHandler: express.RequestHandler = async (
  req,
  res,
) => {
  // 🚨 LOG ULTRA PRIORITAIRE
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logger.log("🏓 PADDLE WEBHOOK HANDLER APPELÉ !");
  logger.log("URL:", req.url);
  logger.log("Method:", req.method);
  logger.log(
    "Paddle-Signature:",
    req.headers["paddle-signature"] ? "Présent" : "ABSENT",
  );

  // 🔍 DEBUG DÉTAILLÉ DU BODY
  const isBuffer = Buffer.isBuffer(req.body);
  logger.log("Body is Buffer:", isBuffer);
  logger.log("Body type:", typeof req.body);
  logger.log("Body constructor:", req.body?.constructor?.name);
  logger.log(
    "Body length:",
    isBuffer
      ? req.body.length
      : typeof req.body === "string"
        ? req.body.length
        : JSON.stringify(req.body).length,
  );

  // 🔍 Afficher les premiers caractères du body pour debug
  if (isBuffer) {
    logger.log(
      "Body preview (Buffer→String):",
      req.body.toString("utf8").substring(0, 100) + "...",
    );
  } else if (typeof req.body === "string") {
    logger.log("Body preview (String):", req.body.substring(0, 100) + "...");
  } else {
    logger.log(
      "Body preview (Object):",
      JSON.stringify(req.body).substring(0, 100) + "...",
    );
  }
  logger.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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
      event = await paddle.webhooks.unmarshal(rawBody, secretKey, signature);
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

    // 2️⃣ IDEMPOTENCE - Éviter de traiter 2x le même événement
    if (eventId) {
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (alreadyProcessed) {
        logger.log(
          `⏭️ [Paddle Webhook] Event déjà traité: ${eventType} - ${eventId}`,
        );
        return res
          .status(200)
          .json({ skipped: true, reason: "already_processed" });
      }
    }

    // 3️⃣ Extraire le userId depuis customData
    // Le frontend doit passer { clerkUserId: "user_xxx" } lors du checkout
    const customData = extractCustomData(eventData);
    let userId: string | undefined | null =
      customData.clerkUserId ?? customData.clerk_user_id;

    // Si pas de customData, essayer de retrouver via paddleCustomerId
    const customerId = extractString(eventData, "customerId", "customer_id");
    if (!userId && customerId) {
      userId =
        await PaddleBillingService.findUserByPaddleCustomerId(customerId);
    }

    // Si pas de userId via customData, essayer via subscriptionId
    const dataId = extractString(eventData, "id");
    if (!userId && dataId) {
      userId =
        await PaddleBillingService.findUserByPaddleSubscriptionId(dataId);
    }

    // 4️⃣ TRAITER LES ÉVÉNEMENTS
    // Use type guards to safely access subscription/transaction data
    const subData = isSubscriptionEvent(event) ? event.data : undefined;
    const txnData = isTransactionEvent(event) ? event.data : undefined;

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

      // 🎁 TRIAL: Si status "trialing", activer premium immédiatement
      if (
        subscriptionStatus === "trialing" &&
        userId &&
        paddleCustomerId &&
        paddleSubscriptionId
      ) {
        const trialStart = new Date();
        const trialEnd = subData?.currentBillingPeriod?.endsAt
          ? new Date(subData.currentBillingPeriod.endsAt)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours par défaut

        logger.log(`🎁 [Paddle Webhook] TRIAL activé pour user ${userId}:`, {
          trialStart: trialStart.toISOString(),
          trialEnd: trialEnd.toISOString(),
          paddleCustomerId,
          paddleSubscriptionId,
        });

        await PaddleBillingService.activatePremium(
          userId,
          paddleCustomerId,
          paddleSubscriptionId,
          trialEnd,
          { trialStart, trialEnd },
        );

        if (eventId) {
          await prisma.webhookEvent.create({
            data: { eventId, type: eventType, processedAt: new Date() },
          });
        }

        return res
          .status(200)
          .json({ success: true, message: "trial_activated" });
      }

      // Si pas de trial ou pas de userId, juste logger
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res
        .status(200)
        .json({ success: true, message: "subscription_created_logged" });
    }

    // ✅ subscription.activated - Plan activé
    if (eventType === EventName.SubscriptionActivated) {
      if (!userId) {
        logger.warn(
          `⚠️ [Paddle Webhook] subscription.activated sans userId:`,
          {
            subscriptionId: subData?.id,
            customerId: subData?.customerId,
            customData,
          },
        );
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const paddleCustomerId = subData?.customerId;
      const paddleSubscriptionId = subData?.id;

      if (!paddleCustomerId || !paddleSubscriptionId) {
        logger.warn(
          `⚠️ [Paddle Webhook] subscription.activated missing required fields:`,
          { paddleCustomerId, paddleSubscriptionId },
        );
        return res
          .status(200)
          .json({ skipped: true, reason: "missing_subscription_data" });
      }

      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      logger.log(`✅ [Paddle Webhook] subscription.activated:`, {
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
        status: subData?.status,
        currentPeriodEnd: currentPeriodEnd.toISOString(),
      });

      // Activer le premium
      await PaddleBillingService.activatePremium(
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
        currentPeriodEnd,
      );

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // 🔄 subscription.updated - Mise à jour subscription
    if (eventType === EventName.SubscriptionUpdated) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.updated sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const currentPeriodStart = subData?.currentBillingPeriod?.startsAt
        ? new Date(subData.currentBillingPeriod.startsAt)
        : undefined;
      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : undefined;
      const scheduledChange = subData?.scheduledChange;

      logger.log(`🔄 [Paddle Webhook] subscription.updated:`, {
        userId,
        status: subData?.status,
        currentPeriodStart: currentPeriodStart?.toISOString(),
        currentPeriodEnd: currentPeriodEnd?.toISOString(),
        scheduledChange: scheduledChange
          ? {
              action: scheduledChange.action,
              effectiveAt: scheduledChange.effectiveAt,
            }
          : undefined,
      });

      // Mettre à jour les périodes
      await PaddleBillingService.updateSubscription(userId, {
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: scheduledChange?.action === "cancel",
      });

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // ⚠️ subscription.canceled - Annulé (mais actif jusqu'à fin période)
    if (eventType === EventName.SubscriptionCanceled) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.canceled sans userId`);
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
        logger.log(
          `✅ [Paddle Webhook] Subscription marquée pour annulation: ${userId}`,
        );
      }

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // ⏸️ subscription.paused - Plan en pause
    if (eventType === EventName.SubscriptionPaused) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.paused sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      logger.log(`⏸️ [Paddle Webhook] subscription.paused:`, { userId });

      // Mettre en pause = retour temporaire au free
      await PaddleBillingService.finalizeCancel(userId);

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // ▶️ subscription.resumed - Plan repris
    if (eventType === EventName.SubscriptionResumed) {
      if (!userId) {
        logger.warn(`⚠️ [Paddle Webhook] subscription.resumed sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const paddleCustomerId = subData?.customerId;
      const paddleSubscriptionId = subData?.id;

      if (!paddleCustomerId || !paddleSubscriptionId) {
        logger.warn(
          `⚠️ [Paddle Webhook] subscription.resumed missing required fields:`,
          { paddleCustomerId, paddleSubscriptionId },
        );
        return res
          .status(200)
          .json({ skipped: true, reason: "missing_subscription_data" });
      }

      const currentPeriodEnd = subData?.currentBillingPeriod?.endsAt
        ? new Date(subData.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      logger.log(`▶️ [Paddle Webhook] subscription.resumed:`, {
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
      });

      // Réactiver le premium
      await PaddleBillingService.activatePremium(
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
        currentPeriodEnd,
      );

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

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
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res
        .status(200)
        .json({ success: true, message: "payment_completed_logged" });
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

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type: eventType, processedAt: new Date() },
        });
      }

      return res
        .status(200)
        .json({ success: true, message: "payment_failed_logged" });
    }

    // Si on arrive ici, événement non géré mais valide
    logger.log(`⏭️ [Paddle Webhook] Event non géré: ${eventType}`);

    if (eventId) {
      await prisma.webhookEvent.create({
        data: { eventId, type: eventType, processedAt: new Date() },
      });
    }

    return res.status(200).json({ received: true, unhandled: eventType });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("[Paddle Webhook] ❌ Erreur:", errorMessage);
    return res.status(500).json({ error: "Webhook error" });
  }
};
