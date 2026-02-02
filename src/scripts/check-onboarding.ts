import { prisma } from "../lib/prisma.js";
import { logger } from "../utils/logger.js";

async function checkOnboarding() {
  try {
    logger.log("\n🔍 Vérification du statut onboarding...\n");

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        onboardingCompleted: true,
      },
    });

    if (users.length === 0) {
      logger.log("❌ Aucun utilisateur trouvé");
      return;
    }

    logger.log(`📊 ${users.length} utilisateur(s) trouvé(s):\n`);

    users.forEach((user, index) => {
      logger.log(`${index + 1}. ${user.firstName} ${user.lastName}`);
      logger.log(`   Email: ${user.email}`);
      logger.log(`   ID: ${user.id}`);
      logger.log(`   onboardingCompleted: ${user.onboardingCompleted}`);
      logger.log(`   Type: ${typeof user.onboardingCompleted}`);

      if (user.onboardingCompleted === false) {
        logger.log(
          "   ⚠️  ONBOARDING NON COMPLÉTÉ - Cet utilisateur verra la page onboarding",
        );
      } else if (user.onboardingCompleted === true) {
        logger.log(
          "   ✅ ONBOARDING COMPLÉTÉ - Cet utilisateur ne devrait PAS voir la page onboarding",
        );
      } else {
        logger.log(`   ⚠️  VALEUR INATTENDUE: ${user.onboardingCompleted}`);
      }
      logger.log("");
    });

    await prisma.$disconnect();
  } catch (error) {
    logger.error("❌ Erreur:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkOnboarding();
