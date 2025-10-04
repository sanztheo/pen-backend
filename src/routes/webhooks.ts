import express from 'express';
import { Webhook } from 'svix';
import { prisma } from '../lib/prisma.js';
import { createClerkClient } from '@clerk/backend';

/**
 * 🎯 WEBHOOK CLERK SIMPLIFIÉ
 *
 * Principe : Juste écouter et appliquer ce que Clerk nous dit
 * - subscriptionItem.active → Appliquer le plan actif
 * - subscriptionItem.ended → IGNORER (ancien plan qui se termine)
 * - user.created/updated → Sync user
 */

export const clerkWebhookHandler: express.RequestHandler = async (req, res) => {
  try {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'CLERK_WEBHOOK_SECRET manquant' });
    }

    // 1️⃣ Vérifier la signature Clerk
    const payload = (req.body as Buffer).toString('utf8');
    const headers = req.headers as Record<string, string>;

    const wh = new Webhook(secret);
    let evt: any;
    try {
      evt = wh.verify(payload, headers);
    } catch (e) {
      console.error('[Clerk Webhook] ❌ Signature invalide');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const type = evt.type as string;
    const data = evt.data as any;
    const eventId = evt.id as string;

    // 2️⃣ IDEMPOTENCE - Éviter de traiter 2x le même événement
    if (eventId) {
      const alreadyProcessed = await prisma.webhookEvent.findUnique({
        where: { eventId }
      });

      if (alreadyProcessed) {
        console.log(`⏭️ [Webhook] Event déjà traité: ${type} - ${eventId}`);
        return res.status(200).json({ skipped: true, reason: 'already_processed' });
      }
    }

    // 3️⃣ Filtrer les événements pertinents
    const relevantEvents = [
      'user.created',
      'user.updated',
      'subscriptionItem.active',   // ✅ Plan actif
      // ❌ On n'écoute PAS subscriptionItem.ended (ancien plan qui se termine)
    ];

    if (!relevantEvents.includes(type)) {
      console.log(`⏭️ [Webhook] Event ignoré: ${type}`);
      return res.status(200).json({ received: true, ignored: type });
    }

    // 4️⃣ Extraire le userId
    let userId: string | undefined;

    // Pour user.*, l'ID est dans data.id
    if (type?.startsWith('user.') && data?.id?.startsWith('user_')) {
      userId = data.id;
    }

    // Pour subscriptionItem.*, chercher dans payer
    if (!userId && type?.includes('subscriptionItem')) {
      const candidates = [
        data?.payer?.user_id,
        data?.payer_id,
      ].filter(Boolean);

      userId = candidates.find((id: any) => typeof id === 'string' && id.startsWith('user_'));
    }

    if (!userId) {
      console.log(`⏭️ [Webhook] Aucun userId trouvé dans: ${type}`);
      return res.status(200).json({ skipped: true, reason: 'no_user_id' });
    }

    // 5️⃣ S'assurer que l'utilisateur existe
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: 'CLERK_SECRET_KEY manquant' });
    }

    const clerk = createClerkClient({ secretKey });
    let clerkUser;
    try {
      clerkUser = await clerk.users.getUser(userId);
    } catch (e) {
      console.warn(`⏭️ [Webhook] User introuvable côté Clerk: ${userId}`);
      return res.status(200).json({ skipped: true, reason: 'user_not_found' });
    }

    // Upsert l'utilisateur
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

    // 6️⃣ TRAITER LES ÉVÉNEMENTS

    // 👤 User events
    if (type === 'user.created' || type === 'user.updated') {
      // S'assurer que la subscription existe (free par défaut)
      const now = new Date();
      await prisma.userSubscription.upsert({
        where: { userId },
        update: {}, // Ne rien changer si existe déjà
        create: {
          userId,
          plan: 'free_user',
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.setMonth(now.getMonth() + 1)),
        }
      });

      // Calculer l'usage réel
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
          projectsLimit: 4,
          customQuizzesLimit: 5,
          presetSequencesLimit: 1,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          lastResetAt: new Date(),
          resetType: 'monthly',
        }
      });

      console.log(`✅ [Webhook] ${type} traité pour: ${userId}`);

      // Marquer comme traité
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() }
        });
      }

      return res.status(200).json({ success: true });
    }

    // 💰 SubscriptionItem.active - PLAN ACTIF
    if (type === 'subscriptionItem.active') {
      // Extraire le plan depuis data.plan.slug
      const planSlug = data?.plan?.slug || 'free_user';
      const plan = planSlug === 'premium' ? 'premium' : 'free_user';

      console.log(`💰 [Webhook] subscriptionItem.active détecté:`, {
        userId,
        planSlug,
        plan,
        planData: data?.plan
      });

      // Appliquer directement ce que Clerk nous dit
      const now = new Date();
      await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan: plan as any,
          status: 'active',
          updatedAt: new Date(),
        },
        create: {
          userId,
          plan: plan as any,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.setMonth(now.getMonth() + 1)),
        }
      });

      // Calculer l'usage réel
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

      // Mettre à jour les limites selon le plan
      const isPremium = plan === 'premium';
      await prisma.userLimits.upsert({
        where: { userId },
        update: {
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: isPremium ? -1 : 4,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
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
          projectsLimit: isPremium ? -1 : 4,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          lastResetAt: new Date(),
          resetType: 'monthly',
        }
      });

      console.log(`✅ [Webhook] subscriptionItem.active appliqué:`, {
        userId,
        plan,
        limits: isPremium ? 'PREMIUM' : 'FREE'
      });

      // Marquer comme traité
      if (eventId) {
        await prisma.webhookEvent.create({
          data: { eventId, type, processedAt: new Date() }
        });
      }

      return res.status(200).json({ success: true });
    }

    // Si on arrive ici, événement non géré
    return res.status(200).json({ received: true });

  } catch (err: any) {
    console.error('[Clerk Webhook] ❌ Erreur:', err?.message || err);
    return res.status(500).json({ error: 'Webhook error' });
  }
};
