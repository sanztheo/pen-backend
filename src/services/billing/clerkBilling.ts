import { prisma } from '../../lib/prisma.js';
import type { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import SecureLogger from '../../middlewares/secureLogging.js';

/**
 * Configuration des plans de billing Clerk (prix gérés dans Clerk Dashboard)
 */
export const BILLING_PLANS = {
  free_user: {
    name: 'Gratuit'
  },
  premium: {
    name: 'Premium'
  }
} as const;

/**
 * Service de gestion du billing basique (sans SDK Clerk côté serveur)
 * Les modifications de plan se font côté client avec Clerk
 */
export class ClerkBillingService {
  
  /**
   * Récupère l'abonnement d'un utilisateur depuis la DB locale
   */
  static async getUserSubscription(userId: string) {
    try {
      // 🔇 [BILLING] Log silencieux pour éviter le spam (debug only)
      
      // Récupérer de la DB locale
      let subscription = await prisma.userSubscription.findUnique({
        where: { userId }
      });
      
      if (!subscription) {
        // Créer un abonnement gratuit par défaut avec upsert pour éviter les conflits
        subscription = await prisma.userSubscription.upsert({
          where: { userId },
          create: {
            userId,
            plan: 'free_user',
            status: 'active',
            currentPeriodStart: new Date(),
          },
          update: {} // Pas de mise à jour si existe déjà
        });
        console.log(`✅ [BILLING] Abonnement gratuit créé/vérifié pour ${userId}`);
      }
      
      return {
        ...subscription,
        planInfo: BILLING_PLANS[subscription.plan],
        isActive: subscription.status === 'active',
        isPremium: subscription.plan === 'premium'
      };
      
    } catch (error) {
      console.error('❌ [BILLING] Erreur récupération abonnement:', error);
      
      // Fallback : utilisateur gratuit par défaut
      return {
        userId,
        plan: 'free_user' as SubscriptionPlan,
        status: 'active' as SubscriptionStatus,
        planInfo: BILLING_PLANS.free_user,
        isActive: true,
        isPremium: false
      };
    }
  }
  
  /**
   * Met à niveau un utilisateur vers Premium (mise à jour DB locale)
   */
  static async upgradeToPremium(userId: string) {
    try {
      console.log(`⬆️ [BILLING] Upgrade vers Premium pour: ${userId}`);
      
      // Mettre à jour la DB locale
      const subscription = await prisma.userSubscription.upsert({
        where: { userId },
        update: {
          plan: 'premium',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
        },
        create: {
          userId,
          plan: 'premium',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
        }
      });
      
      // 🔄 Synchroniser automatiquement les limites après changement de plan
      await this.syncUserLimitsAfterPlanChange(userId, 'premium');
      
      console.log(`✅ [BILLING] Upgrade Premium réussi pour: ${userId}`);
      return subscription;
      
    } catch (error) {
      console.error('❌ [BILLING] Erreur upgrade Premium:', error);
      throw error;
    }
  }
  
  /**
   * Annule l'abonnement Premium d'un utilisateur
   */
  static async cancelSubscription(userId: string) {
    try {
      console.log(`🚫 [BILLING] Annulation abonnement pour: ${userId}`);
      
      // Mettre à jour la DB locale
      const subscription = await prisma.userSubscription.update({
        where: { userId },
        data: {
          plan: 'free_user',
          status: 'canceled',
          canceledAt: new Date()
        }
      });
      
      // 🔄 Synchroniser automatiquement les limites après changement de plan
      await this.syncUserLimitsAfterPlanChange(userId, 'free_user');
      
      console.log(`✅ [BILLING] Abonnement annulé pour: ${userId}`);
      return subscription;
      
    } catch (error) {
      console.error('❌ [BILLING] Erreur annulation:', error);
      throw error;
    }
  }
  
  /**
   * Synchronise les limites utilisateur après un changement de plan
   * @param userId - ID de l'utilisateur
   * @param newPlan - Nouveau plan (premium ou free_user)
   */
  static async syncUserLimitsAfterPlanChange(userId: string, newPlan: SubscriptionPlan) {
    try {
      SecureLogger.debug(`🔄 [BILLING] Synchronisation limites après changement de plan`, { userId, newPlan });
      
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

      const isPremium = newPlan === 'premium';

      // Synchroniser les limites avec l'usage réel et le nouveau plan
      const updatedLimits = await prisma.userLimits.upsert({
        where: { userId },
        update: {
          // Mettre à jour les limites selon le nouveau plan
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: isPremium ? -1 : 4,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          // Synchroniser l'usage avec les données réelles
          workspacesUsed: workspacesCount,
          projectsUsed: projectsCount,
          customQuizzesUsed: customQuizzesCount,
          presetSequencesUsed: presetSequencesCount,
          aiCreditsUsed: Math.max(0, aiCreditsUsed),
        },
        create: {
          userId,
          // Limites selon le nouveau plan
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
        }
      });

      SecureLogger.debug(`✅ [BILLING] Limites synchronisées après changement de plan`, { 
        userId, 
        newPlan: isPremium ? 'PREMIUM' : 'FREE',
        limits: {
          aiCredits: `${updatedLimits.aiCreditsUsed}/${updatedLimits.aiCreditsLimit === -1 ? '∞' : updatedLimits.aiCreditsLimit}`,
          workspaces: `${updatedLimits.workspacesUsed}/${updatedLimits.workspacesLimit === -1 ? '∞' : updatedLimits.workspacesLimit}`,
          projects: `${updatedLimits.projectsUsed}/${updatedLimits.projectsLimit === -1 ? '∞' : updatedLimits.projectsLimit}`,
          customQuizzes: `${updatedLimits.customQuizzesUsed}/${updatedLimits.customQuizzesLimit === -1 ? '∞' : updatedLimits.customQuizzesLimit}`,
          presetSequences: `${updatedLimits.presetSequencesUsed}/${updatedLimits.presetSequencesLimit === -1 ? '∞' : updatedLimits.presetSequencesLimit}`
        }
      });

      return updatedLimits;
      
    } catch (error) {
      SecureLogger.error('❌ [BILLING] Erreur synchronisation limites après changement de plan', error);
      throw error;
    }
  }

  /**
   * Récupère les statistiques basiques d'un utilisateur
   */
  static async getUserStats(userId: string) {
    try {
      const subscription = await this.getUserSubscription(userId);
      
      return {
        subscription,
        isPremium: subscription.isPremium
      };
      
    } catch (error) {
      console.error('❌ [BILLING] Erreur récupération stats:', error);
      throw error;
    }
  }
}