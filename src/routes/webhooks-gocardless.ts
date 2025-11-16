import express from "express";
import crypto from "crypto";
import { gcClient } from "../lib/gocardless.js";
import { prisma } from "../lib/prisma.js";

/**
 * 🎯 WEBHOOK GOCARDLESS - Gestion événements paiements
 *
 * Événements gérés:
 * - payments.confirmed → Paiement réussi
 * - payments.failed → Paiement échoué
 * - mandates.created → Mandat créé (autorisation prélèvement)
 * - mandates.cancelled → Mandat annulé
 * - mandates.failed → Mandat échoué
 * - subscriptions.created → Abonnement créé
 * - subscriptions.payment_created → Nouveau paiement généré
 * - subscriptions.finished → Abonnement terminé
 */

export const gocardlessWebhookHandler: express.RequestHandler = async (
  req,
  res,
) => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚨 WEBHOOK GOCARDLESS REÇU !");
  console.log("URL:", req.url);
  console.log("Method:", req.method);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    // 1️⃣ Vérifier la signature webhook
    const signature = req.headers["webhook-signature"] as string;
    const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;

    if (!secret) {
      console.error("❌ GOCARDLESS_WEBHOOK_SECRET manquant");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    const payload = (req.body as Buffer).toString("utf8");

    // Calculer HMAC SHA-256
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    if (signature !== expectedSignature) {
      console.error("❌ Signature invalide");
      return res.status(401).json({ error: "Invalid signature" });
    }

    console.log("✅ Signature valide");

    // 2️⃣ Parser le payload
    const body = JSON.parse(payload);
    const events = body.events || [];

    console.log(`📨 ${events.length} événement(s) reçu(s)`);

    // 3️⃣ Traiter chaque événement
    for (const event of events) {
      const eventId = event.id;
      const resourceType = event.resource_type;
      const action = event.action;

      console.log(`\n🔍 Event: ${resourceType}.${action} (ID: ${eventId})`);

      // Idempotence: vérifier si déjà traité
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (alreadyProcessed) {
        console.log(`⏭️ Événement déjà traité: ${eventId}`);
        continue;
      }

      // Router vers le bon handler
      await handleEvent(event);

      // Marquer comme traité
      await prisma.webhookEvent.create({
        data: {
          eventId,
          type: `${resourceType}.${action}`,
          processedAt: new Date(),
        },
      });

      console.log(`✅ Événement traité: ${eventId}`);
    }

    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error("❌ Erreur webhook GoCardless:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Handler principal des événements
async function handleEvent(event: any) {
  const { resource_type, action, links } = event;

  // 💳 PAYMENTS - Paiements
  if (resource_type === "payments") {
    if (action === "confirmed") {
      await handlePaymentConfirmed(event);
    }
    if (action === "failed") {
      await handlePaymentFailed(event);
    }
  }

  // 📝 MANDATES - Autorisations prélèvement
  if (resource_type === "mandates") {
    if (action === "created" || action === "active") {
      await handleMandateCreated(event);
    }
    if (action === "cancelled") {
      await handleMandateCancelled(event);
    }
    if (action === "failed") {
      await handleMandateFailed(event);
    }
  }

  // 🔄 SUBSCRIPTIONS - Abonnements récurrents
  if (resource_type === "subscriptions") {
    if (action === "created") {
      await handleSubscriptionCreated(event);
    }
    if (action === "payment_created") {
      await handleSubscriptionPaymentCreated(event);
    }
    if (action === "finished" || action === "cancelled") {
      await handleSubscriptionFinished(event);
    }
  }
}

// 💳 Paiement confirmé
async function handlePaymentConfirmed(event: any) {
  const paymentId = event.links.payment;

  // Récupérer détails paiement
  const payment = await gcClient.payments.find(paymentId);
  const customerId = payment.links?.customer;

  if (!customerId) {
    console.warn("⚠️ Pas de customer_id dans payment");
    return;
  }

  // Trouver user par gocardlessCustomerId
  const user = await prisma.user.findFirst({
    where: { gocardlessCustomerId: customerId },
  });

  if (!user) {
    console.warn(`⚠️ User introuvable pour customer: ${customerId}`);
    return;
  }

  console.log(
    `💰 Paiement confirmé: ${payment.amount} ${payment.currency} pour user: ${user.id}`,
  );

  // Activer premium
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.userSubscription.upsert({
    where: { userId: user.id },
    update: {
      plan: "premium",
      status: "active",
      paymentMethod: "gocardless",
      lastPaymentDate: new Date(payment.charge_date),
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      updatedAt: new Date(),
    },
    create: {
      userId: user.id,
      plan: "premium",
      status: "active",
      paymentMethod: "gocardless",
      gocardlessCustomerId: customerId,
      lastPaymentDate: new Date(payment.charge_date),
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  // Mettre à jour limites premium
  await updateUserLimitsToPremium(user.id);

  // Logger paiement
  await prisma.paymentLog.create({
    data: {
      userId: user.id,
      provider: "gocardless",
      providerId: paymentId,
      amount: parseInt(payment.amount),
      currency: payment.currency,
      status: "confirmed",
      metadata: payment,
    },
  });

  console.log(`✅ Premium activé pour user: ${user.id}`);
}

// ❌ Paiement échoué
async function handlePaymentFailed(event: any) {
  const paymentId = event.links.payment;

  const payment = await gcClient.payments.find(paymentId);
  const customerId = payment.links?.customer;

  if (!customerId) return;

  const user = await prisma.user.findFirst({
    where: { gocardlessCustomerId: customerId },
  });

  if (!user) return;

  console.log(`❌ Paiement échoué pour user: ${user.id}`);

  // Marquer subscription comme past_due
  await prisma.userSubscription.update({
    where: { userId: user.id },
    data: {
      status: "past_due",
      updatedAt: new Date(),
    },
  });

  // Logger échec
  await prisma.paymentLog.create({
    data: {
      userId: user.id,
      provider: "gocardless",
      providerId: paymentId,
      amount: parseInt(payment.amount),
      currency: payment.currency,
      status: "failed",
      metadata: payment,
    },
  });

  // TODO: Envoyer email utilisateur
}

// 📝 Mandat créé (autorisation prélèvement)
async function handleMandateCreated(event: any) {
  const mandateId = event.links.mandate;

  const mandate = await gcClient.mandates.find(mandateId);
  const customerId = mandate.links?.customer;

  if (!customerId) return;

  const user = await prisma.user.findFirst({
    where: { gocardlessCustomerId: customerId },
  });

  if (!user) return;

  console.log(`📝 Mandat créé pour user: ${user.id}`);

  await prisma.userSubscription.upsert({
    where: { userId: user.id },
    update: {
      gocardlessMandateId: mandateId,
      mandateReference: mandate.reference,
      mandateStatus: mandate.status,
      updatedAt: new Date(),
    },
    create: {
      userId: user.id,
      plan: "free_user",
      status: "active",
      paymentMethod: "gocardless",
      gocardlessCustomerId: customerId,
      gocardlessMandateId: mandateId,
      mandateReference: mandate.reference,
      mandateStatus: mandate.status,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

// 🚫 Mandat annulé
async function handleMandateCancelled(event: any) {
  const mandateId = event.links.mandate;

  const subscription = await prisma.userSubscription.findFirst({
    where: { gocardlessMandateId: mandateId },
  });

  if (!subscription) return;

  console.log(`🚫 Mandat annulé pour user: ${subscription.userId}`);

  // Repasser en free
  await prisma.userSubscription.update({
    where: { userId: subscription.userId },
    data: {
      plan: "free_user",
      status: "canceled",
      mandateStatus: "cancelled",
      updatedAt: new Date(),
    },
  });

  await updateUserLimitsToFree(subscription.userId);
}

// ❌ Mandat échoué
async function handleMandateFailed(event: any) {
  const mandateId = event.links.mandate;

  const subscription = await prisma.userSubscription.findFirst({
    where: { gocardlessMandateId: mandateId },
  });

  if (!subscription) return;

  console.log(`❌ Mandat échoué pour user: ${subscription.userId}`);

  await prisma.userSubscription.update({
    where: { userId: subscription.userId },
    data: {
      mandateStatus: "failed",
      status: "incomplete",
      updatedAt: new Date(),
    },
  });

  // TODO: Envoyer email utilisateur
}

// 🔄 Abonnement créé
async function handleSubscriptionCreated(event: any) {
  const subscriptionId = event.links.subscription;

  const subscription = await gcClient.subscriptions.find(subscriptionId);
  const customerId = subscription.links?.customer;

  if (!customerId) return;

  const user = await prisma.user.findFirst({
    where: { gocardlessCustomerId: customerId },
  });

  if (!user) return;

  console.log(`🔄 Abonnement créé pour user: ${user.id}`);

  await prisma.userSubscription.update({
    where: { userId: user.id },
    data: {
      gocardlessSubscriptionId: subscriptionId,
      nextPaymentDate: subscription.upcoming_payments?.[0]?.charge_date
        ? new Date(subscription.upcoming_payments[0].charge_date)
        : null,
      updatedAt: new Date(),
    },
  });
}

// 💰 Nouveau paiement généré par subscription
async function handleSubscriptionPaymentCreated(event: any) {
  const paymentId = event.links.payment;
  console.log(`💰 Nouveau paiement subscription généré: ${paymentId}`);
  // Le paiement sera traité par payments.confirmed
}

// 🔚 Abonnement terminé
async function handleSubscriptionFinished(event: any) {
  const subscriptionId = event.links.subscription;

  const userSubscription = await prisma.userSubscription.findFirst({
    where: { gocardlessSubscriptionId: subscriptionId },
  });

  if (!userSubscription) return;

  console.log(`🔚 Abonnement terminé pour user: ${userSubscription.userId}`);

  // Repasser en free
  await prisma.userSubscription.update({
    where: { userId: userSubscription.userId },
    data: {
      plan: "free_user",
      status: "canceled",
      updatedAt: new Date(),
    },
  });

  await updateUserLimitsToFree(userSubscription.userId);
}

// Helper: Mettre à jour limites premium
async function updateUserLimitsToPremium(userId: string) {
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

  await prisma.userLimits.upsert({
    where: { userId },
    update: {
      aiCreditsLimit: -1,
      workspacesLimit: -1,
      projectsLimit: -1,
      customQuizzesLimit: -1,
      presetSequencesLimit: -1,
      historyQuizzesLimit: -1,
      statsChartsLimit: [],
      workspacesUsed: workspacesCount,
      projectsUsed: projectsCount,
      customQuizzesUsed: customQuizzesCount,
      presetSequencesUsed: presetSequencesCount,
      aiCreditsUsed: Math.max(0, aiCreditsUsed),
    },
    create: {
      userId,
      aiCreditsLimit: -1,
      workspacesLimit: -1,
      projectsLimit: -1,
      customQuizzesLimit: -1,
      presetSequencesLimit: -1,
      historyQuizzesLimit: -1,
      statsChartsLimit: [],
      aiCreditsUsed: Math.max(0, aiCreditsUsed),
      workspacesUsed: workspacesCount,
      projectsUsed: projectsCount,
      customQuizzesUsed: customQuizzesCount,
      presetSequencesUsed: presetSequencesCount,
      lastResetAt: new Date(),
      resetType: "monthly",
    },
  });
}

// Helper: Mettre à jour limites free
async function updateUserLimitsToFree(userId: string) {
  await prisma.userLimits.update({
    where: { userId },
    data: {
      aiCreditsLimit: 50,
      workspacesLimit: 2,
      projectsLimit: -1,
      customQuizzesLimit: 5,
      presetSequencesLimit: 1,
      historyQuizzesLimit: 5,
      statsChartsLimit: ["progression-area", "difficulty-radar"],
      // RESET usage
      aiCreditsUsed: 0,
      workspacesUsed: 0,
      projectsUsed: 0,
      customQuizzesUsed: 0,
      presetSequencesUsed: 0,
      lastResetAt: new Date(),
    },
  });
}

export default gocardlessWebhookHandler;
