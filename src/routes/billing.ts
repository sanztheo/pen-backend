import express from 'express';
import { ClerkBillingService } from '../services/billing/clerkBilling.js';
import { authenticateToken } from '../middlewares/auth.js';
import { AuthService } from '../services/auth.js';
import { createClerkClient } from '@clerk/backend';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

/**
 * GET /api/billing/subscription
 * Récupère l'abonnement actuel de l'utilisateur
 */
router.get('/subscription', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    // console.log(`📊 [API] Récupération abonnement pour: ${userId}`);
    
    const subscription = await ClerkBillingService.getUserSubscription(userId);
    // console.log('📊 [BILLING][GET /subscription] Utilisateur:', userId, 'Abonnement:', subscription);
    
    res.json({
      success: true,
      subscription
    });

  } catch (error) {
    console.error('❌ [API] Erreur récupération abonnement:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération de l\'abonnement',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

/**
 * POST /api/billing/upgrade
 * 🚨 SÉCURITÉ: Endpoint désactivé pour éviter l'escalade de privilèges
 * Les upgrades ne doivent se faire que via les webhooks Clerk/Stripe
 */
router.post('/upgrade', authenticateToken, async (req, res) => {
  console.error(`🚨 [SÉCURITÉ] Tentative d'upgrade non autorisée par: ${req.user?.id}`);
  return res.status(403).json({ 
    error: 'Endpoint désactivé pour des raisons de sécurité',
    message: 'Les upgrades doivent se faire via Clerk Commerce uniquement'
  });
});

/**
 * POST /api/billing/cancel
 * 🚨 SÉCURITÉ: Endpoint désactivé pour éviter la manipulation d'abonnements
 * Les annulations ne doivent se faire que via les webhooks Clerk/Stripe
 */
router.post('/cancel', authenticateToken, async (req, res) => {
  console.error(`🚨 [SÉCURITÉ] Tentative d'annulation non autorisée par: ${req.user?.id}`);
  return res.status(403).json({ 
    error: 'Endpoint désactivé pour des raisons de sécurité',
    message: 'Les annulations doivent se faire via Clerk Commerce uniquement'
  });
});

/**
 * GET /api/billing/stats
 * Récupère les statistiques de l'utilisateur
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    console.log(`📈 [API] Récupération stats pour: ${userId}`);
    
    const stats = await ClerkBillingService.getUserStats(userId);
    console.log('📈 [BILLING][GET /stats] Stats:', { userId, isPremium: stats.isPremium, plan: stats.subscription.plan });
    
    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('❌ [API] Erreur récupération stats:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des statistiques',
      details: error instanceof Error ? error.message : 'Erreur inconnue'
    });
  }
});

export default router;

/**
 * POST /api/billing/sync-from-clerk
 * Synchronise la table user_subscriptions depuis l'état Clerk de l'utilisateur courant
 */
router.post('/sync-from-clerk', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Utilisateur non authentifié' });
    }

    // Récupérer l'utilisateur Clerk (source de vérité) via l'API backend Clerk
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: 'CLERK_SECRET_KEY manquant' });
    }
    const clerk = createClerkClient({ secretKey });
    const clerkUser = await clerk.users.getUser(userId);
    console.log('🔎 [BILLING][SYNC] Clerk metadata:', {
      publicMetadata: clerkUser.publicMetadata,
      unsafeMetadata: clerkUser.unsafeMetadata,
      privateMetadata: clerkUser.privateMetadata,
    });

    // Lire plan/status depuis publicMetadata (fallback unsafe/privateMetadata)
    const publicMeta: any = clerkUser.publicMetadata || {};
    const unsafeMeta: any = clerkUser.unsafeMetadata || {};
    const privateMeta: any = clerkUser.privateMetadata || {};
    const planRaw = (publicMeta.plan as string) || (unsafeMeta.plan as string) || (privateMeta.plan as string) || 'free_user';
    const statusRaw = (publicMeta.subscriptionStatus as string) || (unsafeMeta.subscriptionStatus as string) || (privateMeta.subscriptionStatus as string) || 'active';
    const plan = planRaw === 'premium' ? 'premium' : 'free_user';

    const subscription = await prisma.userSubscription.upsert({
      where: { userId },
      update: { plan: plan as any, status: statusRaw as any },
      create: {
        userId,
        plan: plan as any,
        status: statusRaw as any,
        currentPeriodStart: new Date(),
      },
    });
    console.log('🔄 [BILLING][POST /sync-from-clerk] Sync effectuée:', { userId, plan: subscription.plan, status: subscription.status });

    return res.json({ success: true, subscription });
  } catch (error: any) {
    console.error('❌ [API] Erreur sync-from-clerk:', error);
    return res.status(500).json({ error: 'Erreur lors de la synchronisation' });
  }
});

/**
 * GET /api/billing/plans
 * Récupère la liste des plans publiés depuis Clerk (id, name, description)
 */
router.get('/plans', authenticateToken, async (req, res) => {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return res.status(500).json({ error: 'CLERK_SECRET_KEY manquant' });
    }

    // Appel direct à l’API Clerk BAPI (Commerce Plans)
    const response = await fetch('https://api.clerk.com/v1/commerce/plans?limit=100', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('❌ [BILLING][GET /plans] Erreur Clerk:', response.status, text);
      return res.status(500).json({ error: 'Erreur Clerk lors de la récupération des plans' });
    }

    const data: any = await response.json();
    const plans = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

    const mapped = plans.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description || p.summary || '',
      interval: p.interval || p.billing_interval || null,
      price_cents: p.price_amount || p.amount || null,
      currency: p.price_currency || p.currency || null,
      public: p.publicly_available ?? true,
      metadata: p.public_metadata || p.metadata || {},
    }));

    return res.json({ success: true, plans: mapped });
  } catch (error: any) {
    console.error('❌ [API] Erreur /api/billing/plans:', error?.message || error);
    return res.status(500).json({ error: 'Erreur lors de la récupération des plans' });
  }
});