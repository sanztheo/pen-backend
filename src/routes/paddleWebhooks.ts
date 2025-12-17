import express from "express";
import {
  paddle,
  PaddleBillingService,
} from "../services/billing/paddleBilling.js";
import { prisma } from "../lib/prisma.js";
import { EventName } from "@paddle/paddle-node-sdk";

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
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🏓 PADDLE WEBHOOK HANDLER APPELÉ !");
  console.log("URL:", req.url);
  console.log("Method:", req.method);
  console.log(
    "Paddle-Signature:",
    req.headers["paddle-signature"] ? "Présent" : "ABSENT",
  );
  console.log("Body type:", typeof req.body);
  console.log(
    "Body length:",
    Buffer.isBuffer(req.body) ? req.body.length : "Not a buffer",
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const signature = req.headers["paddle-signature"] as string;
    const rawBody = (req.body as Buffer).toString("utf8");
    const secretKey = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secretKey) {
      console.error("[Paddle Webhook] ❌ PADDLE_WEBHOOK_SECRET manquant");
      return res.status(500).json({ error: "PADDLE_WEBHOOK_SECRET manquant" });
    }

    if (!signature) {
      console.error("[Paddle Webhook] ❌ Header paddle-signature manquant");
      return res.status(400).json({ error: "Missing paddle-signature header" });
    }

    // 1️⃣ Vérifier la signature Paddle
    let event: any;
    try {
      event = paddle.webhooks.unmarshal(rawBody, secretKey, signature);
      console.log(`✅ [Paddle Webhook] Signature valide`);
    } catch (e: any) {
      console.error("[Paddle Webhook] ❌ Signature invalide:", e.message);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const eventType = event.eventType as string;
    const eventId = event.eventId as string;
    const data = event.data as any;

    // 🔍 DEBUG: Log le type d'événement reçu
    console.log(`📨 [Paddle Webhook] Type: ${eventType}, EventID: ${eventId}`);

    // 2️⃣ IDEMPOTENCE - Éviter de traiter 2x le même événement
    if (eventId) {
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (alreadyProcessed) {
        console.log(
          `⏭️ [Paddle Webhook] Event déjà traité: ${eventType} - ${eventId}`,
        );
        return res
          .status(200)
          .json({ skipped: true, reason: "already_processed" });
      }
    }

    // 3️⃣ Extraire le userId depuis customData
    // Le frontend doit passer { clerkUserId: "user_xxx" } lors du checkout
    const customData = data?.customData || data?.custom_data || {};
    let userId = customData?.clerkUserId || customData?.clerk_user_id;

    // Si pas de customData, essayer de retrouver via paddleCustomerId
    if (!userId && data?.customerId) {
      userId = await PaddleBillingService.findUserByPaddleCustomerId(
        data.customerId,
      );
    }

    // Si pas de userId via customData, essayer via subscriptionId
    if (!userId && data?.id) {
      userId = await PaddleBillingService.findUserByPaddleSubscriptionId(
        data.id,
      );
    }

    // 4️⃣ TRAITER LES ÉVÉNEMENTS

    // 📝 subscription.created - Subscription créée (attendre activated)
    if (
      eventType === EventName.SubscriptionCreated ||
      eventType === "subscription.created"
    ) {
      console.log(`📝 [Paddle Webhook] subscription.created:`, {
        subscriptionId: data?.id,
        customerId: data?.customerId,
        status: data?.status,
        customData,
      });

      // Juste logger, attendre subscription.activated pour activer le plan
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
    if (
      eventType === EventName.SubscriptionActivated ||
      eventType === "subscription.activated"
    ) {
      if (!userId) {
        console.warn(
          `⚠️ [Paddle Webhook] subscription.activated sans userId:`,
          {
            subscriptionId: data?.id,
            customerId: data?.customerId,
            customData,
          },
        );
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const paddleCustomerId = data?.customerId || data?.customer_id;
      const paddleSubscriptionId = data?.id;
      const currentPeriodEnd = data?.currentBillingPeriod?.endsAt
        ? new Date(data.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      console.log(`✅ [Paddle Webhook] subscription.activated:`, {
        userId,
        paddleCustomerId,
        paddleSubscriptionId,
        status: data?.status,
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
    if (
      eventType === EventName.SubscriptionUpdated ||
      eventType === "subscription.updated"
    ) {
      if (!userId) {
        console.warn(`⚠️ [Paddle Webhook] subscription.updated sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const currentPeriodStart = data?.currentBillingPeriod?.startsAt
        ? new Date(data.currentBillingPeriod.startsAt)
        : undefined;
      const currentPeriodEnd = data?.currentBillingPeriod?.endsAt
        ? new Date(data.currentBillingPeriod.endsAt)
        : undefined;
      const scheduledChange = data?.scheduledChange;

      console.log(`🔄 [Paddle Webhook] subscription.updated:`, {
        userId,
        status: data?.status,
        currentPeriodStart: currentPeriodStart?.toISOString(),
        currentPeriodEnd: currentPeriodEnd?.toISOString(),
        scheduledChange,
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
    if (
      eventType === EventName.SubscriptionCanceled ||
      eventType === "subscription.canceled"
    ) {
      if (!userId) {
        console.warn(`⚠️ [Paddle Webhook] subscription.canceled sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const effectiveAt = data?.scheduledChange?.effectiveAt
        ? new Date(data.scheduledChange.effectiveAt)
        : undefined;

      console.log(`⚠️ [Paddle Webhook] subscription.canceled:`, {
        userId,
        status: data?.status,
        effectiveAt: effectiveAt?.toISOString(),
      });

      // Si le status est "canceled" (plus actif), remettre en free
      if (data?.status === "canceled") {
        await PaddleBillingService.finalizeCancel(userId);
        console.log(`✅ [Paddle Webhook] Utilisateur remis en free: ${userId}`);
      } else {
        // Sinon juste marquer comme annulé (actif jusqu'à fin période)
        await PaddleBillingService.cancelSubscription(userId, effectiveAt);
        console.log(
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
    if (
      eventType === EventName.SubscriptionPaused ||
      eventType === "subscription.paused"
    ) {
      if (!userId) {
        console.warn(`⚠️ [Paddle Webhook] subscription.paused sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      console.log(`⏸️ [Paddle Webhook] subscription.paused:`, { userId });

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
    if (
      eventType === EventName.SubscriptionResumed ||
      eventType === "subscription.resumed"
    ) {
      if (!userId) {
        console.warn(`⚠️ [Paddle Webhook] subscription.resumed sans userId`);
        return res.status(200).json({ skipped: true, reason: "no_user_id" });
      }

      const paddleCustomerId = data?.customerId || data?.customer_id;
      const paddleSubscriptionId = data?.id;
      const currentPeriodEnd = data?.currentBillingPeriod?.endsAt
        ? new Date(data.currentBillingPeriod.endsAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      console.log(`▶️ [Paddle Webhook] subscription.resumed:`, {
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
    if (
      eventType === EventName.TransactionCompleted ||
      eventType === "transaction.completed"
    ) {
      console.log(`💳 [Paddle Webhook] transaction.completed:`, {
        transactionId: data?.id,
        subscriptionId: data?.subscriptionId,
        status: data?.status,
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
    if (
      eventType === EventName.TransactionPaymentFailed ||
      eventType === "transaction.payment_failed"
    ) {
      console.log(`❌ [Paddle Webhook] transaction.payment_failed:`, {
        transactionId: data?.id,
        subscriptionId: data?.subscriptionId,
        errorCode: data?.payments?.[0]?.errorCode,
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
    console.log(`⏭️ [Paddle Webhook] Event non géré: ${eventType}`);

    if (eventId) {
      await prisma.webhookEvent.create({
        data: { eventId, type: eventType, processedAt: new Date() },
      });
    }

    return res.status(200).json({ received: true, unhandled: eventType });
  } catch (err: any) {
    console.error("[Paddle Webhook] ❌ Erreur:", err?.message || err);
    return res.status(500).json({ error: "Webhook error" });
  }
};
