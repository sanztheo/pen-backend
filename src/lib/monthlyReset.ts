import { prisma } from './prisma.js';

/**
 * Fonction de maintenance pour réinitialiser les limites mensuellement
 * À exécuter via un CRON job quotidien
 */
export async function processMonthlyResets() {
  console.log('🔄 [Monthly Reset] Démarrage du processus de reset mensuel...');
  
  try {
    const now = new Date();
    
    // Récupérer tous les utilisateurs avec un plan gratuit qui pourraient nécessiter un reset
    const usersToCheck = await prisma.user.findMany({
      where: {
        subscription: {
          plan: 'free_user'
        }
      },
      include: {
        subscription: true,
        userLimits: true
      }
    });

    let resetCount = 0;
    
    for (const user of usersToCheck) {
      if (!user.userLimits || !user.subscription) continue;

      const limits = user.userLimits;
      const subscription = user.subscription;

      // Utiliser la date de début de période comme référence
      const referenceDate = subscription.currentPeriodStart || new Date(limits.lastResetAt);

      // Calculer la prochaine date de reset (même jour du mois suivant)
      // Amélioration: gérer les fins de mois correctement
      const nextResetDate = new Date(referenceDate);
      const originalDay = referenceDate.getDate();
      nextResetDate.setMonth(nextResetDate.getMonth() + 1);

      // Si le jour a changé (ex: 31 jan → 3 mars), ajuster au dernier jour du mois
      if (nextResetDate.getDate() !== originalDay) {
        nextResetDate.setDate(0); // Dernier jour du mois précédent
      }

      // Si on a dépassé la date de reset, réinitialiser
      if (now >= nextResetDate) {
        console.log(`🔄 [Monthly Reset] Reset pour utilisateur ${user.id}`, {
          lastReset: limits.lastResetAt,
          currentPeriodStart: subscription.currentPeriodStart?.toISOString(),
          nextReset: nextResetDate.toISOString(),
          subscription: subscription.plan
        });

        // Calculer la nouvelle période
        const newPeriodStart = new Date(now);
        const newPeriodEnd = new Date(now);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

        // Ajuster si fin de mois problématique
        const newOriginalDay = newPeriodStart.getDate();
        if (newPeriodEnd.getDate() !== newOriginalDay) {
          newPeriodEnd.setDate(0);
        }

        // Mettre à jour les limites ET la période de subscription
        await prisma.$transaction([
          prisma.userLimits.update({
            where: { userId: user.id },
            data: {
              // Reset uniquement les crédits consommables
              aiCreditsUsed: 0,
              customQuizzesUsed: 0,
              presetSequencesUsed: 0,
              lastResetAt: now,
            }
          }),
          prisma.userSubscription.update({
            where: { userId: user.id },
            data: {
              currentPeriodStart: newPeriodStart,
              currentPeriodEnd: newPeriodEnd,
            }
          })
        ]);

        resetCount++;
      }
    }
    
    // Traitement des downgrades programmés (cancelAtPeriodEnd = true)
    const downgradeCount = await processScheduledDowngrades(now);
    
    console.log(`✅ [Monthly Reset] Terminé: ${resetCount} resets effectués, ${downgradeCount} downgrades traités`);
    
    return { resetCount, downgradeCount };
    
  } catch (error) {
    console.error('❌ [Monthly Reset] Erreur:', error);
    throw error;
  }
}

/**
 * Traite les downgrades programmés (cancelAtPeriodEnd = true)
 */
async function processScheduledDowngrades(now: Date) {
  const subscriptionsToDowngrade = await prisma.userSubscription.findMany({
    where: {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: {
        lte: now // Période terminée
      }
    }
  });

  let downgradeCount = 0;
  
  for (const subscription of subscriptionsToDowngrade) {
    console.log(`📉 [Scheduled Downgrade] Downgrade utilisateur ${subscription.userId} vers free_user`);
    
    // Calculer la nouvelle période mensuelle
    const newPeriodStart = now;
    const newPeriodEnd = new Date(now);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    
    // Downgrade vers free_user
    await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: {
        plan: 'free_user',
        cancelAtPeriodEnd: false,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
      }
    });
    
    // Réappliquer les limites FREE
    await prisma.userLimits.update({
      where: { userId: subscription.userId },
      data: {
        aiCreditsLimit: 50,
        workspacesLimit: 2,
        projectsLimit: -1,
        customQuizzesLimit: 5,
        presetSequencesLimit: 1,
        // Reset des crédits consommables
        aiCreditsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        lastResetAt: now,
      }
    });
    
    downgradeCount++;
  }
  
  return downgradeCount;
}

/**
 * Fonction pour tester le reset d'un utilisateur spécifique
 */
export async function testUserReset(userId: string) {
  console.log(`🧪 [Test Reset] Test reset pour utilisateur ${userId}`);
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true, userLimits: true }
  });
  
  if (!user?.userLimits) {
    throw new Error('Utilisateur ou limites non trouvés');
  }
  
  const now = new Date();
  await prisma.userLimits.update({
    where: { userId },
    data: {
      aiCreditsUsed: 0,
      customQuizzesUsed: 0,
      presetSequencesUsed: 0,
      lastResetAt: now,
    }
  });
  
  console.log(`✅ [Test Reset] Reset effectué pour ${userId}`);
  return { success: true, resetAt: now };
}