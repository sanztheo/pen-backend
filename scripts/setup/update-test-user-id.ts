/**
 * 🔄 Script de mise à jour de l'ID du compte test E2E
 * 
 * Met à jour l'ID temporaire avec l'ID Clerk réel.
 * 
 * Usage: npx tsx scripts/setup/update-test-user-id.ts <clerk_user_id>
 * Exemple: npx tsx scripts/setup/update-test-user-id.ts user_2abc123...
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const TEST_EMAIL = 'test.e2e@pennote.test';
const OLD_ID = 'user_test_e2e_playwright';

async function updateTestUserId() {
  const newId = process.argv[2];

  if (!newId) {
    console.error('❌ Usage: npx tsx scripts/setup/update-test-user-id.ts <clerk_user_id>');
    console.error('   Exemple: npx tsx scripts/setup/update-test-user-id.ts user_2abc123xyz');
    process.exit(1);
  }

  if (!newId.startsWith('user_')) {
    console.error('❌ L\'ID doit commencer par "user_"');
    process.exit(1);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('🔄 MISE À JOUR ID COMPTE TEST E2E');
  console.log('═'.repeat(70));
  console.log(`📧 Email: ${TEST_EMAIL}`);
  console.log(`🆔 Ancien ID: ${OLD_ID}`);
  console.log(`🆔 Nouvel ID: ${newId}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findFirst({
      where: { email: TEST_EMAIL }
    });

    if (!user) {
      console.error('❌ Utilisateur de test non trouvé. Lance d\'abord:');
      console.error('   npx tsx scripts/setup/create-test-user.ts');
      process.exit(1);
    }

    if (user.id === newId) {
      console.log('✅ L\'ID est déjà correct, rien à faire.');
      return;
    }

    console.log('📝 Mise à jour en cours...\n');

    // Mettre à jour l'utilisateur avec une transaction
    await prisma.$transaction(async (tx) => {
      // 1. Mettre à jour les tables liées d'abord (foreign keys)
      await tx.userSubscription.updateMany({
        where: { userId: user.id },
        data: { userId: newId }
      });
      console.log('   ✅ UserSubscription mis à jour');

      await tx.userLimits.updateMany({
        where: { userId: user.id },
        data: { userId: newId }
      });
      console.log('   ✅ UserLimits mis à jour');

      await tx.workspace.updateMany({
        where: { ownerId: user.id },
        data: { ownerId: newId }
      });
      console.log('   ✅ Workspaces mis à jour');

      // 2. Mettre à jour l'utilisateur lui-même
      // Note: Prisma ne supporte pas UPDATE de la primary key
      // Il faut supprimer et recréer
      await tx.user.delete({ where: { id: user.id } });
      await tx.user.create({
        data: {
          id: newId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          updatedAt: new Date(),
        }
      });
      console.log('   ✅ User mis à jour');
    });

    console.log('\n' + '═'.repeat(70));
    console.log('✅ MISE À JOUR TERMINÉE');
    console.log('═'.repeat(70));
    console.log(`
L'utilisateur de test est maintenant lié à Clerk.

Prochaine étape:
   Configure le mot de passe dans pen-frontend/.env.local:
   
   PLAYWRIGHT_TEST_EMAIL=${TEST_EMAIL}
   PLAYWRIGHT_TEST_PASSWORD=ton_mot_de_passe_clerk
`);
    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Erreur:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateTestUserId().catch(console.error);
