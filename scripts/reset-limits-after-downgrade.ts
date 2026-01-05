/**
 * Script pour reset les limites d'un utilisateur après un downgrade
 * Usage: npx tsx scripts/reset-limits-after-downgrade.ts [userId]
 *
 * Si aucun userId n'est fourni, liste tous les utilisateurs free avec des limites non reset
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];

  if (!userId) {
    // Lister tous les utilisateurs potentiellement affectés
    console.log(
      "🔍 Recherche des utilisateurs free avec limites non réinitialisées...\n",
    );

    const affectedUsers = await prisma.$queryRaw<
      Array<{
        user_id: string;
        plan: string;
        ai_credits_used: number;
        ai_credits_limit: number;
        last_reset_at: Date;
      }>
    >`
      SELECT
        ul.user_id,
        us.plan,
        ul.ai_credits_used,
        ul.ai_credits_limit,
        ul.last_reset_at
      FROM user_limits ul
      JOIN user_subscriptions us ON ul.user_id = us.user_id
      WHERE us.plan = 'free_user'
        AND (ul.ai_credits_used > 0 OR ul.custom_quizzes_used > 0 OR ul.preset_sequences_used > 0)
      ORDER BY ul.last_reset_at ASC
    `;

    if (affectedUsers.length === 0) {
      console.log("✅ Aucun utilisateur affecté trouvé.");
      return;
    }

    console.log(`📋 ${affectedUsers.length} utilisateur(s) affecté(s):\n`);
    for (const user of affectedUsers) {
      console.log(`  - User ID: ${user.user_id}`);
      console.log(`    Plan: ${user.plan}`);
      console.log(
        `    Crédits AI: ${user.ai_credits_used}/${user.ai_credits_limit}`,
      );
      console.log(`    Dernier reset: ${user.last_reset_at}`);
      console.log("");
    }

    console.log(
      "\n💡 Pour reset un utilisateur spécifique, relancez avec son ID:",
    );
    console.log(
      "   npx tsx scripts/reset-limits-after-downgrade.ts <user_id>\n",
    );
    return;
  }

  // Reset pour un utilisateur spécifique
  console.log(`🔄 Reset des limites pour l'utilisateur: ${userId}\n`);

  // Vérifier que l'utilisateur existe et est en plan free
  const subscription = await prisma.userSubscription.findUnique({
    where: { userId },
  });

  if (!subscription) {
    console.error(`❌ Utilisateur ${userId} non trouvé.`);
    return;
  }

  console.log(`📊 Plan actuel: ${subscription.plan}`);

  // Récupérer les limites actuelles
  const currentLimits = await prisma.userLimits.findUnique({
    where: { userId },
  });

  if (currentLimits) {
    console.log(`\n📈 Limites AVANT reset:`);
    console.log(
      `   - Crédits AI: ${currentLimits.aiCreditsUsed}/${currentLimits.aiCreditsLimit}`,
    );
    console.log(
      `   - Quiz custom: ${currentLimits.customQuizzesUsed}/${currentLimits.customQuizzesLimit}`,
    );
    console.log(
      `   - Séquences: ${currentLimits.presetSequencesUsed}/${currentLimits.presetSequencesLimit}`,
    );
    console.log(`   - Dernier reset: ${currentLimits.lastResetAt}`);
  }

  // Effectuer le reset
  const now = new Date();
  const updatedLimits = await prisma.userLimits.upsert({
    where: { userId },
    update: {
      aiCreditsUsed: 0,
      customQuizzesUsed: 0,
      presetSequencesUsed: 0,
      lastResetAt: now,
      // S'assurer que les limites correspondent au plan free
      aiCreditsLimit: 50,
      customQuizzesLimit: 5,
      presetSequencesLimit: 1,
      workspacesLimit: 2,
    },
    create: {
      userId,
      aiCreditsUsed: 0,
      aiCreditsLimit: 50,
      customQuizzesUsed: 0,
      customQuizzesLimit: 5,
      presetSequencesUsed: 0,
      presetSequencesLimit: 1,
      workspacesLimit: 2,
      workspacesUsed: 0,
      projectsLimit: -1,
      projectsUsed: 0,
      lastResetAt: now,
    },
  });

  console.log(`\n✅ Limites APRÈS reset:`);
  console.log(
    `   - Crédits AI: ${updatedLimits.aiCreditsUsed}/${updatedLimits.aiCreditsLimit}`,
  );
  console.log(
    `   - Quiz custom: ${updatedLimits.customQuizzesUsed}/${updatedLimits.customQuizzesLimit}`,
  );
  console.log(
    `   - Séquences: ${updatedLimits.presetSequencesUsed}/${updatedLimits.presetSequencesLimit}`,
  );
  console.log(`   - Dernier reset: ${updatedLimits.lastResetAt}`);

  console.log(`\n🎉 Reset terminé avec succès!`);
}

main()
  .catch((e) => {
    console.error("❌ Erreur:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
