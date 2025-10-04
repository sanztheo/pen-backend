import express from 'express';
import { Webhook } from 'svix';
import { prisma } from '../lib/prisma.js';
import { createClerkClient } from '@clerk/backend';

// Fonction pour vérifier et effectuer le reset mensuel des limitations
async function checkAndResetMonthlyLimits(userId: string, subscription: any) {
  const limits = await prisma.userLimits.findUnique({
    where: { userId }
  });

  if (!limits) return null; // Pas de limites configurées

  const now = new Date();
  const lastResetDate = new Date(limits.lastResetAt);
  
  // Utiliser la date de début de période comme référence ou le jour de création
  const referenceDate = subscription.currentPeriodStart 
    ? new Date(subscription.currentPeriodStart)
    : lastResetDate;
  
  // Calculer la prochaine date de reset (même jour du mois suivant)
  const nextResetDate = new Date(referenceDate);
  nextResetDate.setMonth(nextResetDate.getMonth() + 1);
  
  // Si on a dépassé la date de reset ET que c'est un plan gratuit, réinitialiser
  if (now >= nextResetDate && subscription.plan === 'free_user') {
    console.log(`🔄 [Webhook] Reset mensuel des limites pour ${userId}`, {
      lastReset: lastResetDate.toISOString(),
      nextReset: nextResetDate.toISOString(),
      plan: subscription.plan
    });

    return await prisma.userLimits.update({
      where: { userId },
      data: {
        // Reset uniquement les crédits consommables (pas les workspaces/projets permanents)
        aiCreditsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        lastResetAt: now,
      }
    });
  }

  return null; // Pas de reset nécessaire
}

// Fonction pour gérer les changements de plan avec respect des cycles de facturation
async function handlePlanChange(userId: string, newPlan: string, newStatus: string, webhookData: any) {
  const existing = await prisma.userSubscription.findUnique({
    where: { userId }
  });

  const now = new Date();
  let currentPeriodStart = now;
  let currentPeriodEnd = new Date(now);
  currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

  // Récupérer les dates du webhook si disponibles
  if (webhookData.current_period_start) {
    currentPeriodStart = new Date(webhookData.current_period_start * 1000);
  } else if (webhookData.currentPeriodStart) {
    currentPeriodStart = new Date(webhookData.currentPeriodStart);
  } else if (existing?.currentPeriodStart) {
    currentPeriodStart = existing.currentPeriodStart;
  }

  if (webhookData.current_period_end) {
    currentPeriodEnd = new Date(webhookData.current_period_end * 1000);
  } else if (webhookData.currentPeriodEnd) {
    currentPeriodEnd = new Date(webhookData.currentPeriodEnd);
  } else if (existing?.currentPeriodEnd) {
    currentPeriodEnd = existing.currentPeriodEnd;
  }

  // Gestion des changements de plan
  let cancelAtPeriodEnd = false;

  // ✅ FIX: Always process plan logic, even for new subscriptions
  const oldPlan = existing ? existing.plan : 'free_user';

  // Si l'abonnement est terminé (ended/expired), effet immédiat vers free_user
  if (newStatus === 'ended' || newStatus === 'expired' || newStatus === 'canceled') {
    console.log(`🔚 [Webhook] Abonnement terminé ${userId}: ${oldPlan} → ${newPlan} (was going to force free_user)`);

    // IMPORTANT: Ne pas downgrader si le plan actuel en base est déjà premium
    // (cas d'un ancien plan gratuit qui se termine pendant un upgrade vers premium)
    if (oldPlan === 'premium') {
      console.log(`🔚 [Webhook] Keeping current premium plan (old plan ended during upgrade)`);
      newPlan = 'premium';
    }
    // Ne pas forcer free_user si le nouveau plan est premium (transition active)
    else if (newPlan !== 'premium') {
      console.log(`🔚 [Webhook] Forcing free_user because newPlan=${newPlan}`);
      newPlan = 'free_user';
    } else {
      console.log(`🔚 [Webhook] Keeping premium plan during transition`);
    }
    cancelAtPeriodEnd = false;
  }
  // Si downgrade de premium vers free, appliquer à la fin de la période (sauf si ended)
  else if (oldPlan === 'premium' && newPlan === 'free_user') {
    console.log(`📉 [Webhook] Downgrade détecté ${userId}: ${oldPlan} → ${newPlan}, effet à la fin de période: ${currentPeriodEnd.toISOString()}`);
    cancelAtPeriodEnd = true;
    // Conserver le plan premium jusqu'à la fin de la période
    newPlan = 'premium';
  }
  // Si upgrade vers premium, effet immédiat
  else if (oldPlan === 'free_user' && newPlan === 'premium') {
    console.log(`📈 [Webhook] Upgrade détecté ${userId}: ${oldPlan} → ${newPlan}, effet immédiat`);
    cancelAtPeriodEnd = false;
  }
  // ✅ FIX: Handle new premium subscriptions (no existing record)
  else if (!existing && newPlan === 'premium') {
    console.log(`🆕 [Webhook] Nouvelle souscription premium ${userId}, effet immédiat`);
    cancelAtPeriodEnd = false;
  }

  return {
    plan: newPlan,
    status: newStatus,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    clerkSubscriptionId: webhookData.id || webhookData.subscription_id || existing?.clerkSubscriptionId || null
  };
}

export const clerkWebhookHandler: express.RequestHandler = async (req, res) => {
  try {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: 'CLERK_WEBHOOK_SECRET manquant' });

    const payload = (req.body as Buffer).toString('utf8');
    const headers = req.headers as Record<string, string>;

    const wh = new Webhook(secret);
    let evt: any;
    try {
      evt = wh.verify(payload, headers);
    } catch (e) {
      console.error('[Clerk Webhook] Signature invalide');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const type = evt.type as string;
    const data = evt.data as any;
    const eventId = evt.id as string;

    // ✅ IDEMPOTENCE: Vérifier si l'événement a déjà été traité
    if (eventId) {
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId }
      });

      if (alreadyProcessed) {
        console.log('⏭️ [Clerk Webhook] Event already processed, skipping', { eventId, type });
        return res.status(200).json({ skipped: true, reason: 'already_processed' });
      }
    }

    const relevant = [
      'user.updated',
      'user.created',
      // Nouveaux webhooks de billing Clerk
      'subscription.created',
      'subscription.updated',
      'subscription.active',
      'subscription.past_due',
      'subscriptionItem.created',
      'subscriptionItem.updated',
      'subscriptionItem.active',
      'subscriptionItem.canceled',
      'subscriptionItem.ended',
      'paymentAttempt.created',
      'paymentAttempt.updated',
      // Anciens webhooks pour compatibilité
      'billing.subscription.created',
      'billing.subscription.updated',
      'billing.subscription.canceled',
      'subscription.switched',
    ];
    if (!relevant.includes(type)) return res.status(200).json({ received: true });

    // Ne jamais utiliser data.id (souvent un ID d'abonnement). On veut l'ID Clerk user_*
    // 0) Déterminer le userId selon le type d'event
    let userId: string | undefined = undefined;

    // Pour les événements user.*, l'ID est directement dans data.id
    if (type?.startsWith('user.') && typeof data?.id === 'string' && data.id.startsWith('user_')) {
      userId = data.id;
    }

    // Pour les événements billing (subscription*, subscriptionItem*, payment*), prioriser payer
    if (!userId && (type?.includes('subscription') || type?.includes('payment'))) {
      const billingCandidates = [
        data?.payer?.user_id,      // ✅ Priorité 1 selon doc Clerk
        data?.payer_id,             // ✅ Priorité 2
        data?.items?.[0]?.payer?.user_id,
        data?.items?.[0]?.payer_id,
      ].filter(Boolean);

      userId = billingCandidates.find((id: any) => typeof id === 'string' && id.startsWith('user_')) as string | undefined;
    }

    // Fallback pour autres cas
    if (!userId) {
      const fallbackCandidates = [
        data?.user_id,
        data?.userId,
        data?.user?.id,
        data?.actor?.id,
      ].filter(Boolean);

      userId = fallbackCandidates.find((id: any) => typeof id === 'string' && id.startsWith('user_')) as string | undefined;
    }
    if (!userId) {
      console.log('🪝 [Clerk Webhook] Aucune user_id dans event, on ignore', {
        type,
        payer: data?.payer,
        payerId: data?.payer_id,
        status: data?.status,
      });
      return res.status(200).json({ skipped: true });
    }

    // 🛡️ PROTECTION: Ignorer subscriptionItem.ended si l'utilisateur a déjà un abonnement premium actif
    // Cela évite le race condition où subscriptionItem.ended (ancien plan gratuit) arrive après subscription.active (nouveau premium)
    if (type === 'subscriptionItem.ended') {
      const currentSub = await prisma.userSubscription.findUnique({
        where: { userId }
      });

      if (currentSub?.plan === 'premium' && ['active', 'trialing'].includes(currentSub.status)) {
        console.log('🛡️ [Clerk Webhook] Ignoring subscriptionItem.ended - user has active premium subscription', {
          userId,
          currentPlan: currentSub.plan,
          currentStatus: currentSub.status
        });
        return res.status(200).json({
          skipped: true,
          reason: 'premium_active_protected',
          message: 'subscriptionItem.ended ignored to protect active premium subscription'
        });
      }
    }

    // 1) S'assurer que l'utilisateur existe dans PostgreSQL (FK requirement)
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: 'CLERK_SECRET_KEY manquant' });
    }
    const clerk = createClerkClient({ secretKey });
    let clerkUser;
    try {
      clerkUser = await clerk.users.getUser(userId);
    } catch (e: any) {
      console.warn('🪝 [Clerk Webhook] user introuvable côté Clerk, skip', { userId, type });
      return res.status(200).json({ skipped: true });
    }

    await prisma.user.upsert({
      where: { id: userId },
      update: {
        email: clerkUser.emailAddresses?.[0]?.emailAddress || '',
        firstName: clerkUser.firstName || '',
        lastName: clerkUser.lastName || '',
        avatarUrl: clerkUser.imageUrl || undefined,
        updatedAt: new Date(),
      },
      create: {
        id: userId,
        email: clerkUser.emailAddresses?.[0]?.emailAddress || '',
        firstName: clerkUser.firstName || '',
        lastName: clerkUser.lastName || '',
        avatarUrl: clerkUser.imageUrl || undefined,
      }
    });

    // 2) Si event user.*, s'assurer que l'abonnement et les limitations existent
    if (type?.startsWith('user.')) {
      // Upsert de l'abonnement pour éviter les conflits
      const now = new Date();
      const subscription = await prisma.userSubscription.upsert({
        where: { userId },
        update: {}, // Ne rien changer s'il existe déjà
        create: {
          userId,
          plan: 'free_user' as any,
          status: 'active' as any,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
        }
      });
      console.log('🪝 [Clerk Webhook] Subscription OK', { userId, plan: subscription.plan, status: subscription.status });

      // Calculer l'usage réel depuis la base de données
      const [workspacesCount, projectsCount, customQuizzesCount, presetSequencesCount, aiCreditsUsed] = await Promise.all([
        prisma.workspace.count({ where: { ownerId: userId } }),
        prisma.project.count({ where: { createdBy: userId } }),
        prisma.quiz.count({ where: { userId, preset: 'NONE' } }),
        prisma.quizSequence.count({ where: { userId } }),
        prisma.usageRecord.aggregate({
          where: { userId, resourceType: { in: ['ai_credits', 'openai_request'] } },
          _sum: { quantity: true }
        }).then(result => result._sum.quantity || 0)
      ]);

      // Upsert des limitations par défaut (FREE) avec synchronisation de l'usage réel
      await prisma.userLimits.upsert({
        where: { userId },
        update: {
          // Synchroniser l'usage avec les données réelles
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
        },
        create: {
          userId,
          // Limites FREE par défaut
          aiCreditsLimit: 50,
          workspacesLimit: 2,
          projectsLimit: 4,
          customQuizzesLimit: 5,
          presetSequencesLimit: 1,
          // Usage synchronisé avec la réalité
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          lastResetAt: new Date(),
          resetType: 'monthly',
        }
      });
      console.log('🪝 [Clerk Webhook] User limits OK', { userId, limits: 'FREE' });

      // ✅ IDEMPOTENCE: Enregistrer l'événement comme traité
      if (eventId) {
        await prisma.webhookEvent.create({
          data: {
            eventId,
            type,
            processedAt: new Date(),
          }
        });
      }

      return res.status(200).json({ success: true });
    }

    // 3) Déterminer plan/status avec gestion des changements de cycle
    const meta = (data.public_metadata || data.publicMetadata || {}) as any;
    let rawStatus: string = (data.status as string) || (meta.subscriptionStatus as string) || 'active';
    const normalizedStatus = String(rawStatus).toLowerCase();
    const isActive = ['active', 'trialing', 'paid'].includes(normalizedStatus);
    const isEnded = ['ended', 'expired', 'canceled', 'cancelled'].includes(normalizedStatus);
    
    // Extraire le vrai plan depuis les métadonnées Clerk (pas seulement le status)
    const planData = data.plan || meta.plan || data.subscriptionPlan;
    let realPlan = 'free_user';

    if (planData) {
      if (typeof planData === 'string') {
        realPlan = planData;
      } else if (planData.slug) {
        realPlan = planData.slug;
      }
    }

    const initialPlan = isEnded ? 'free_user' : (realPlan === 'premium' ? 'premium' : 'free_user');

    console.log(`🔍 [Webhook Debug] Plan extraction:`, {
      userId,
      type,
      planData,
      realPlan,
      initialPlan,
      isActive,
      isEnded
    });
    
    // Mapper les status vers les valeurs valides de l'enum Prisma
    const mapStatusToPrisma = (status: string): string => {
      const normalized = status.toLowerCase();
      switch (normalized) {
        case 'pending':
        case 'paid':
        case 'trialing':
          return 'active';
        case 'cancelled':
        case 'canceled':
          return 'canceled';
        case 'ended':
        case 'expired':
          return 'ended';
        case 'past_due':
          return 'past_due';
        case 'incomplete':
          return 'incomplete';
        case 'incomplete_expired':
          return 'incomplete_expired';
        default:
          return 'active';
      }
    };
    
    const status = mapStatusToPrisma(rawStatus);

    // 4) Gérer le changement de plan avec respect des cycles
    const planInfo = await handlePlanChange(userId, initialPlan, status, data);

    console.log(`🔍 [Webhook Debug] Plan Info:`, {
      userId,
      type,
      inputPlan: initialPlan,
      outputPlan: planInfo.plan,
      status: planInfo.status
    });

    // 5) Upsert l'abonnement avec la logique de cycle appropriée
    const sub = await prisma.userSubscription.upsert({
      where: { userId },
      update: { 
        plan: planInfo.plan as any, 
        status: planInfo.status as any,
        currentPeriodStart: planInfo.currentPeriodStart,
        currentPeriodEnd: planInfo.currentPeriodEnd,
        cancelAtPeriodEnd: planInfo.cancelAtPeriodEnd,
        clerkSubscriptionId: planInfo.clerkSubscriptionId
      },
      create: { 
        userId, 
        plan: planInfo.plan as any, 
        status: planInfo.status as any, 
        currentPeriodStart: planInfo.currentPeriodStart,
        currentPeriodEnd: planInfo.currentPeriodEnd,
        cancelAtPeriodEnd: planInfo.cancelAtPeriodEnd,
        clerkSubscriptionId: planInfo.clerkSubscriptionId
      },
    });

    // 6) Calculer l'usage réel depuis la base de données
    const [workspacesCount, projectsCount, customQuizzesCount, presetSequencesCount, aiCreditsUsed] = await Promise.all([
      prisma.workspace.count({ where: { ownerId: userId } }),
      prisma.project.count({ where: { createdBy: userId } }),
      prisma.quiz.count({ where: { userId, preset: 'NONE' } }),
      prisma.quizSequence.count({ where: { userId } }),
      prisma.usageRecord.aggregate({
        where: { userId, resourceType: { in: ['ai_credits', 'openai_request'] } },
        _sum: { quantity: true }
      }).then(result => result._sum.quantity || 0)
    ]);

    // 7) Vérifier et effectuer le reset mensuel avant de synchroniser
    const resetResult = await checkAndResetMonthlyLimits(userId, sub);
    
    // 8) Synchroniser les limites avec le nouveau plan
    const isPremium = sub.plan === 'premium';
    await prisma.userLimits.upsert({
      where: { userId },
      update: {
        // Mettre à jour les limites selon le plan
        aiCreditsLimit: isPremium ? -1 : 50,
        workspacesLimit: isPremium ? -1 : 2,
        projectsLimit: isPremium ? -1 : 4,
        customQuizzesLimit: isPremium ? -1 : 5,
        presetSequencesLimit: isPremium ? -1 : 1,
        // Synchroniser l'usage avec les données réelles (sauf si reset vient d'être fait)
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: resetResult ? 0 : customQuizzesCount,
        presetSequencesUsed: resetResult ? 0 : presetSequencesCount,
        aiCreditsUsed: resetResult ? 0 : Math.max(0, aiCreditsUsed),
      },
      create: {
        userId,
        // Limites selon le plan
        aiCreditsLimit: isPremium ? -1 : 50,
        workspacesLimit: isPremium ? -1 : 2,
        projectsLimit: isPremium ? -1 : 4,
        customQuizzesLimit: isPremium ? -1 : 5,
        presetSequencesLimit: isPremium ? -1 : 1,
        // Usage synchronisé avec la réalité
        aiCreditsUsed: Math.max(0, aiCreditsUsed),
        workspacesUsed: workspacesCount,
        projectsUsed: projectsCount,
        customQuizzesUsed: customQuizzesCount,
        presetSequencesUsed: presetSequencesCount,
        lastResetAt: new Date(),
        resetType: 'monthly',
      }
    });

    console.log('🪝 [Clerk Webhook] Sync:', { type, userId, plan: sub.plan, status: sub.status, limits: isPremium ? 'PREMIUM' : 'FREE' });

    // ✅ IDEMPOTENCE: Enregistrer l'événement comme traité
    if (eventId) {
      await prisma.webhookEvent.create({
        data: {
          eventId,
          type,
          processedAt: new Date(),
        }
      });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[Clerk Webhook] Error:', err?.message || err);
    return res.status(500).json({ error: 'Webhook error' });
  }
};


