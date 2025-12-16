/**
 * 🧪 Script de création d'un compte de test E2E
 * 
 * Ce script crée un utilisateur de test dans la DB pour Playwright.
 * L'utilisateur doit AUSSI être créé côté Clerk avec le même email.
 * 
 * Usage: npx tsx scripts/setup/create-test-user.ts
 */

import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Configuration du compte de test
const TEST_USER = {
  id: 'user_test_e2e_playwright',  // ID fictif (sera remplacé par l'ID Clerk réel)
  email: 'test.e2e@pennote.test',
  firstName: 'Test',
  lastName: 'E2E',
};

async function createTestUser() {
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 CRÉATION COMPTE DE TEST E2E');
  console.log('═'.repeat(70));
  console.log(`📧 Email: ${TEST_USER.email}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // 1. Vérifier si l'utilisateur existe déjà
    const existingUser = await prisma.user.findFirst({
      where: { email: TEST_USER.email }
    });

    if (existingUser) {
      console.log('✅ Utilisateur de test existe déjà:');
      console.log(`   ID: ${existingUser.id}`);
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Créé le: ${existingUser.createdAt.toLocaleDateString('fr-FR')}`);
      
      // Afficher les infos de subscription
      const subscription = await prisma.userSubscription.findUnique({
        where: { userId: existingUser.id }
      });
      
      if (subscription) {
        console.log(`\n📋 Subscription:`);
        console.log(`   Plan: ${subscription.plan}`);
        console.log(`   Status: ${subscription.status}`);
      }
      
      return existingUser;
    }

    // 2. Créer l'utilisateur
    console.log('📝 Création de l\'utilisateur de test...\n');
    
    // Note: L'ID sera celui fourni par Clerk
    // Pour l'instant on crée avec un ID temporaire
    const user = await prisma.user.create({
      data: {
        id: TEST_USER.id,
        email: TEST_USER.email,
        firstName: TEST_USER.firstName,
        lastName: TEST_USER.lastName,
      }
    });

    console.log('✅ Utilisateur créé:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);

    // 3. Créer la subscription (free par défaut)
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await prisma.userSubscription.create({
      data: {
        userId: user.id,
        plan: 'free_user',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      }
    });

    console.log('✅ Subscription créée (Free)');

    // 4. Créer les limites
    await prisma.userLimits.create({
      data: {
        userId: user.id,
        aiCreditsLimit: 50,
        aiCreditsUsed: 0,
        workspacesLimit: 2,
        workspacesUsed: 0,
        projectsLimit: -1,
        projectsUsed: 0,
        customQuizzesLimit: 5,
        customQuizzesUsed: 0,
        presetSequencesLimit: 1,
        presetSequencesUsed: 0,
        advancedQuizzesLimit: 10,
        advancedQuizzesUsed: 0,
        lastResetAt: now,
        resetType: 'monthly',
      }
    });

    console.log('✅ Limites créées');

    // 5. Créer un workspace de test
    await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        ownerId: user.id,
      }
    });

    console.log('✅ Workspace de test créé');

    console.log('\n' + '═'.repeat(70));
    console.log('📋 PROCHAINES ÉTAPES');
    console.log('═'.repeat(70));
    console.log(`
1. Crée l'utilisateur dans Clerk Dashboard:
   - Email: ${TEST_USER.email}
   - Mot de passe: choisis un mot de passe pour les tests
   
2. Récupère l'ID Clerk de l'utilisateur créé

3. Mets à jour l'ID dans la DB:
   npx tsx scripts/setup/update-test-user-id.ts <clerk_user_id>
   
4. Configure le mot de passe dans .env.local:
   PLAYWRIGHT_TEST_EMAIL=${TEST_USER.email}
   PLAYWRIGHT_TEST_PASSWORD=ton_mot_de_passe
`);
    console.log('═'.repeat(70) + '\n');

    return user;

  } catch (error) {
    console.error('❌ Erreur:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createTestUser().catch(console.error);
