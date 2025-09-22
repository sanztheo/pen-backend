import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function initUserLimits() {
  console.log('🔧 Initialisation des user_limits pour les utilisateurs existants...');
  
  try {
    // Récupérer tous les utilisateurs qui ont une subscription mais pas de limits
    const users = await prisma.user.findMany({
      where: {
        subscription: {
          isNot: null
        },
        userLimits: null
      },
      include: {
        subscription: true
      }
    });

    console.log(`📊 Trouvé ${users.length} utilisateurs sans limitations`);

    if (users.length === 0) {
      console.log('✅ Tous les utilisateurs ont déjà leurs limitations configurées');
      return;
    }

    // Créer les limitations pour chaque utilisateur
    for (const user of users) {
      const isPremium = user.subscription?.plan === 'premium';
      
      await prisma.userLimits.create({
        data: {
          userId: user.id,
          // Limites selon le plan
          aiCreditsLimit: isPremium ? -1 : 50,
          workspacesLimit: isPremium ? -1 : 2,
          projectsLimit: isPremium ? -1 : 4,
          customQuizzesLimit: isPremium ? -1 : 5,
          presetSequencesLimit: isPremium ? -1 : 1,
          // Usage par défaut à 0
          aiCreditsUsed: 0,
          workspacesUsed: 0,
          projectsUsed: 0,
          customQuizzesUsed: 0,
          presetSequencesUsed: 0,
        }
      });

      console.log(`✅ Créé limitations pour ${user.email} (${isPremium ? 'Premium' : 'Free'})`);
    }

    console.log(`🎉 Terminé ! ${users.length} utilisateurs ont maintenant leurs limitations`);
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Exécuter le script
initUserLimits()
  .catch((error) => {
    console.error('❌ Script échoué:', error);
    process.exit(1);
  });