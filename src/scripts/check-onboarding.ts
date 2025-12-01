import { prisma } from "../lib/prisma.js";

async function checkOnboarding() {
  try {
    console.log("\n🔍 Vérification du statut onboarding...\n");

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
      console.log("❌ Aucun utilisateur trouvé");
      return;
    }

    console.log(`📊 ${users.length} utilisateur(s) trouvé(s):\n`);

    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.firstName} ${user.lastName}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   onboardingCompleted: ${user.onboardingCompleted}`);
      console.log(`   Type: ${typeof user.onboardingCompleted}`);

      if (user.onboardingCompleted === false) {
        console.log(
          "   ⚠️  ONBOARDING NON COMPLÉTÉ - Cet utilisateur verra la page onboarding",
        );
      } else if (user.onboardingCompleted === true) {
        console.log(
          "   ✅ ONBOARDING COMPLÉTÉ - Cet utilisateur ne devrait PAS voir la page onboarding",
        );
      } else {
        console.log(`   ⚠️  VALEUR INATTENDUE: ${user.onboardingCompleted}`);
      }
      console.log("");
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error("❌ Erreur:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkOnboarding();
