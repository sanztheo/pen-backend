import express from "express";
import { Webhook } from "svix";
import { prisma } from "../lib/prisma.js";
import { createClerkClient } from "@clerk/backend";

/**
 * 🎯 WEBHOOK CLERK COMPLET - BILLING & USERS
 *
 * Principe : Écouter et appliquer tous les événements Clerk
 *
 * 👤 USER EVENTS:
 * - user.created/updated → Sync user + init subscription free
 *
 * 💰 SUBSCRIPTION ITEM EVENTS:
 * - subscriptionItem.active → Activer le plan (premium/free)
 * - subscriptionItem.freeTrialEnding → Notification fin d'essai
 * - subscriptionItem.canceled → Annulé mais actif jusqu'à fin période
 * - subscriptionItem.ended → Terminé, retour au free
 * - subscriptionItem.incomplete → Paiement initial échoué, rester en free
 * - subscriptionItem.pastDue → Paiement échoué, alerte utilisateur
 * - subscriptionItem.upcoming → Notification renouvellement
 *
 * 📊 SUBSCRIPTION EVENTS:
 * - subscription.pastDue → Toute la subscription en retard (niveau global)
 */

export const clerkWebhookHandler: express.RequestHandler = async (req, res) => {
  // 🚨 LOG ULTRA PRIORITAIRE - AVANT MÊME LE TRY/CATCH
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚨 WEBHOOK HANDLER APPELÉ !");
  console.log("URL:", req.url);
  console.log("Method:", req.method);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body type:", typeof req.body);
  console.log(
    "Body length:",
    Buffer.isBuffer(req.body) ? req.body.length : "Not a buffer",
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    // 🔍 DEBUG: Log toutes les requêtes webhook entrantes
    console.log(`\n🎯 [Webhook] Requête reçue à ${new Date().toISOString()}`);

    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[Clerk Webhook] ❌ CLERK_WEBHOOK_SECRET manquant");
      return res.status(500).json({ error: "CLERK_WEBHOOK_SECRET manquant" });
    }

    // 1️⃣ Vérifier la signature Clerk
    const payload = (req.body as Buffer).toString("utf8");
    const headers = req.headers as Record<string, string>;

    const wh = new Webhook(secret);
    let evt: any;
    try {
      evt = wh.verify(payload, headers);
      console.log(`✅ [Webhook] Signature valide`);
    } catch (e) {
      console.error("[Clerk Webhook] ❌ Signature invalide:", e);
      return res.status(400).json({ error: "Invalid signature" });
    }

    const type = evt.type as string;
    const data = evt.data as any;
    const eventId = evt.id as string;

    // 🔍 DEBUG: Log le type d'événement reçu
    console.log(`📨 [Webhook] Type: ${type}, EventID: ${eventId}`);

    // 2️⃣ IDEMPOTENCE - Éviter de traiter 2x le même événement
    if (eventId) {
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId },
      });

      if (alreadyProcessed) {
        console.log(`⏭️ [Webhook] Event déjà traité: ${type} - ${eventId}`);
        return res
          .status(200)
          .json({ skipped: true, reason: "already_processed" });
      }
    }

    // 3️⃣ Filtrer les événements pertinents
    const relevantEvents = [
      "user.created",
      "user.updated",
      "subscriptionItem.active", // ✅ Plan activé (upgrade/nouveau)
      "subscriptionItem.freeTrialEnding", // 🎁 Fin d'essai gratuit imminente
      "subscriptionItem.canceled", // ✅ Annulé (actif jusqu'à fin période)
      "subscriptionItem.ended", // ✅ Complètement terminé
      "subscriptionItem.incomplete", // ❌ Paiement initial échoué
      "subscriptionItem.pastDue", // ⚠️ Paiement en retard
      "subscriptionItem.upcoming", // 📅 Renouvellement à venir
      "subscription.pastDue", // 🚨 Subscription globale en retard
    ];

    if (!relevantEvents.includes(type)) {
      console.log(`⏭️ [Webhook] Event ignoré: ${type}`);
      return res.status(200).json({ received: true, ignored: type });
    }

    // 4️⃣ Extraire le userId
    let userId: string | undefined;

    // Pour user.*, l'ID est dans data.id
    if (type?.startsWith("user.") && data?.id?.startsWith("user_")) {
      userId = data.id;
    }

    // Pour subscriptionItem.* et subscription.*, chercher le userId dans plusieurs chemins possibles
    if (
      !userId &&
      (type?.includes("subscriptionItem") || type?.includes("subscription"))
    ) {
      // Essayer plusieurs chemins selon la structure de l'event
      const candidates = [
        data?.payer?.user_id,
        data?.payer_id,
        data?.userId,
        data?.user_id,
      ].filter(Boolean);

      userId = candidates.find(
        (id: any) => typeof id === "string" && id.startsWith("user_"),
      );

      if (!userId) {
        console.warn(`⚠️ [Webhook] Impossible d'extraire userId de ${type}.`, {
          type,
          keys: Object.keys(data || {}),
          payer: data?.payer,
        });
      }
    }

    if (!userId) {
      console.log(`⏭️ [Webhook] Aucun userId trouvé dans: ${type}`);
      return res.status(200).json({ skipped: true, reason: "no_user_id" });
    }

    // 5️⃣ S'assurer que l'utilisateur existe
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: "CLERK_SECRET_KEY manquant" });
    }

    const clerk = createClerkClient({ secretKey });
    let clerkUser;
    try {
      clerkUser = await clerk.users.getUser(userId);
    } catch (e) {
      console.warn(`⏭️ [Webhook] User introuvable côté Clerk: ${userId}`);
      return res.status(200).json({ skipped: true, reason: "user_not_found" });
    }

    // Upsert l'utilisateur
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        email: clerkUser.emailAddresses?.[0]?.emailAddress || "",
        firstName: clerkUser.firstName || "",
        lastName: clerkUser.lastName || "",
        avatarUrl: clerkUser.imageUrl || undefined,
        updatedAt: new Date(),
      },
      create: {
        id: userId,
        email: clerkUser.emailAddresses?.[0]?.emailAddress || "",
        firstName: clerkUser.firstName || "",
        lastName: clerkUser.lastName || "",
        avatarUrl: clerkUser.imageUrl || undefined,
      },
    });

    // 6️⃣ TRAITER LES ÉVÉNEMENTS

    // 👤 User events
    if (type === "user.created" || type === "user.updated") {
      // S'assurer que la subscription existe (free par défaut)
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      await prisma.userSubscription.upsert({
        where: { userId },
        update: {}, // Ne rien changer si existe déjà
        create: {
          userId,
          plan: "free_user",
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      // Calculer l'usage réel
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

      // Upsert limites FREE par défaut
      await prisma.userLimits.upsert({
        where: { userId },
        update: {
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
        },
        create: {
          userId,
          aiCreditsLimit: 50,
          workspacesLimit: 2,
          projectsLimit: -1,
          customQuizzesLimit: 5,
          presetSequencesLimit: 1,
          historyQuizzesLimit: 5,
          statsChartsLimit: ["progression-area", "difficulty-radar"],
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          lastResetAt: new Date(),
          resetType: "monthly",
        },
      });

      console.log(`✅ [Webhook] ${type} traité pour: ${userId}`);

      // Marquer comme traité
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // 💰 SubscriptionItem.active - PLAN ACTIF
    if (type === "subscriptionItem.active") {
      // 🔍 DEBUG: Log le payload COMPLET pour comprendre la structure
      console.log(
        `\n🔍 [DEBUG] Payload COMPLET subscriptionItem.active:`,
        JSON.stringify(data, null, 2),
      );

      // Extraire le plan depuis data.plan.slug
      const planSlug = data?.plan?.slug || "free_user";
      const plan = planSlug === "premium" ? "premium" : "free_user";

      // ✅ DÉTECTER LE FREE TRIAL via is_free_trial (PAS via status qui reste "active")
      const isFreeTrial = data?.is_free_trial === true;
      const freeTrialDays = data?.plan?.free_trial_days || 0;

      // ✅ TIMESTAMPS DÉJÀ EN MILLISECONDES selon doc Clerk (ne PAS multiplier par 1000)
      const periodStart = data?.period_start
        ? new Date(data.period_start) // Déjà en millisecondes
        : new Date();
      const periodEnd = data?.period_end
        ? new Date(data.period_end) // Déjà en millisecondes
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Fallback 30j

      console.log(`💰 [Webhook] subscriptionItem.active détecté:`, {
        userId,
        planSlug,
        plan,
        status: data?.status,
        isFreeTrial,
        freeTrialDays,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        durationDays: Math.round(
          (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
        ),
        rawData: {
          period_start: data?.period_start,
          period_end: data?.period_end,
          status: data?.status,
        },
      });

      await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan: plan as any,
          status: isFreeTrial ? "trialing" : "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        },
        create: {
          userId,
          plan: plan as any,
          status: isFreeTrial ? "trialing" : "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      });

      // Calculer l'usage réel
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

      // Mettre à jour les limites selon le plan
      const isPremium = plan === "premium";
      await prisma.userLimits.upsert({
        where: { userId },
        update: {
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: -1,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          historyQuizzesLimit: isPremium ? -1 : 5,
          statsChartsLimit: isPremium
            ? []
            : ["progression-area", "difficulty-radar"],
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
          historyQuizzesLimit: isPremium ? -1 : 5,
          statsChartsLimit: isPremium
            ? []
            : ["progression-area", "difficulty-radar"],
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          lastResetAt: new Date(),
          resetType: "monthly",
        },
      });

      console.log(`✅ [Webhook] subscriptionItem.active appliqué:`, {
        userId,
        plan,
        limits: isPremium ? "PREMIUM" : "FREE",
      });

      // Marquer comme traité
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // 🔚 SubscriptionItem.canceled - Annulé mais actif jusqu'à fin période
    if (type === "subscriptionItem.canceled") {
      console.log(
        `⚠️ [Webhook] subscriptionItem.canceled - Plan annulé mais actif jusqu'à fin période:`,
        {
          userId,
          planData: data?.plan,
        },
      );

      // Juste logger, ne rien changer (le plan reste actif jusqu'à .ended)
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res
        .status(200)
        .json({ success: true, message: "canceled_but_still_active" });
    }

    // 🔚 SubscriptionItem.ended - Complètement terminé
    if (type === "subscriptionItem.ended") {
      const planSlug = data?.plan?.slug || "free_user";
      console.log(`🔚 [Webhook] subscriptionItem.ended - Plan terminé:`, {
        userId,
        planSlug,
        planData: data?.plan,
      });

      // Si c'est le premium qui se termine → Retour au free
      if (planSlug === "premium") {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await prisma.userSubscription.upsert({
          where: { userId },
          update: {
            plan: "free_user",
            status: "active",
            updatedAt: new Date(),
          },
          create: {
            userId,
            plan: "free_user",
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

        // ⚠️ RESET complet de l'usage lors du retour au FREE
        // Sinon l'utilisateur qui a consommé pendant le trial sera bloqué immédiatement
        await prisma.userLimits.upsert({
          where: { userId },
          update: {
            // Limites FREE
            aiCreditsLimit: 50,
            workspacesLimit: 2,
            projectsLimit: -1,
            customQuizzesLimit: 5,
            presetSequencesLimit: 1,
            historyQuizzesLimit: 5,
            statsChartsLimit: ["progression-area", "difficulty-radar"],
            // RESET usage à 0 pour repartir à zéro
            aiCreditsUsed: 0,
            workspacesUsed: 0,
            projectsUsed: 0,
            customQuizzesUsed: 0,
            presetSequencesUsed: 0,
            lastResetAt: new Date(),
          },
          create: {
            userId,
            // Limites FREE
            aiCreditsLimit: 50,
            workspacesLimit: 2,
            projectsLimit: -1,
            customQuizzesLimit: 5,
            presetSequencesLimit: 1,
            historyQuizzesLimit: 5,
            statsChartsLimit: ["progression-area", "difficulty-radar"],
            // Usage à 0
            aiCreditsUsed: 0,
            workspacesUsed: 0,
            projectsUsed: 0,
            customQuizzesUsed: 0,
            presetSequencesUsed: 0,
            lastResetAt: new Date(),
            resetType: "monthly",
          },
        });

        console.log(`✅ [Webhook] Premium ended → free_user appliqué`);
      } else {
        console.log(`⏭️ [Webhook] Free plan ended, ignoré`);
      }

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({ success: true });
    }

    // 🎁 SubscriptionItem.freeTrialEnding - Fin d'essai gratuit imminente
    if (type === "subscriptionItem.freeTrialEnding") {
      const isFreeTrialActive = data?.is_free_trial || false;
      const planName = data?.plan?.name || "Premium";

      console.log(`🎁 [Webhook] subscriptionItem.freeTrialEnding:`, {
        userId,
        isFreeTrialActive,
        planName,
        periodEnd: data?.period_end,
      });

      // TODO: Envoyer notification email à l'utilisateur
      // Exemple: "Votre essai gratuit de {planName} se termine bientôt !"
      // Pour l'instant, juste logger

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({
        success: true,
        message: "free_trial_ending_notification_logged",
      });
    }

    // ❌ SubscriptionItem.incomplete - Paiement initial échoué
    if (type === "subscriptionItem.incomplete") {
      console.log(
        `❌ [Webhook] subscriptionItem.incomplete - Paiement initial échoué:`,
        {
          userId,
          planData: data?.plan,
        },
      );

      // S'assurer que l'utilisateur reste en FREE (ne PAS activer premium)
      await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          status: "incomplete",
          updatedAt: new Date(),
        },
        create: {
          userId,
          plan: "free_user",
          status: "incomplete",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // TODO: Envoyer email "Problème de paiement initial"

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({
        success: true,
        message: "payment_failed_user_stays_free",
      });
    }

    // ⚠️ SubscriptionItem.pastDue - Paiement en retard
    if (type === "subscriptionItem.pastDue") {
      console.log(
        `⚠️ [Webhook] subscriptionItem.pastDue - Paiement en retard:`,
        {
          userId,
          planData: data?.plan,
        },
      );

      // Marquer la subscription comme past_due MAIS garder l'accès premium temporairement
      await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: "past_due",
          updatedAt: new Date(),
        },
      });

      // TODO: Envoyer email urgent "Problème de paiement - mettez à jour votre carte"

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({
        success: true,
        message: "payment_past_due_alert_sent",
      });
    }

    // 📅 SubscriptionItem.upcoming - Renouvellement à venir
    if (type === "subscriptionItem.upcoming") {
      const amount = data?.plan?.amount || 0;
      const currency = data?.plan?.currency || "USD";
      const periodEnd = data?.period_end;

      console.log(
        `📅 [Webhook] subscriptionItem.upcoming - Renouvellement à venir:`,
        {
          userId,
          amount,
          currency,
          periodEnd,
        },
      );

      // TODO: Envoyer email "Votre abonnement se renouvelle le X pour Y€"

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({
        success: true,
        message: "upcoming_renewal_notification_logged",
      });
    }

    // 🚨 Subscription.pastDue - Toute la subscription en retard (niveau global)
    if (type === "subscription.pastDue") {
      console.log(
        `🚨 [Webhook] subscription.pastDue - Subscription globale en retard:`,
        {
          userId,
          subscriptionData: data,
        },
      );

      // Marquer comme past_due et potentiellement bloquer certaines features premium
      await prisma.userSubscription.update({
        where: { userId },
        data: {
          status: "past_due",
          updatedAt: new Date(),
        },
      });

      // TODO: Envoyer email CRITIQUE + potentiellement désactiver certaines features

      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() },
        });
      }

      return res.status(200).json({
        success: true,
        message: "subscription_past_due_critical_alert",
      });
    }

    // Si on arrive ici, événement non géré
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("[Clerk Webhook] ❌ Erreur:", err?.message || err);
    return res.status(500).json({ error: "Webhook error" });
  }
};
