/**
 * 🧪 Script de création d'un compte de test E2E complet
 * 
 * Crée l'utilisateur dans Clerk ET dans la DB locale.
 * 
 * Usage: npx tsx scripts/setup/create-test-user-full.ts
 * 
 * ⚠️ Requires CLERK_SECRET_KEY in .env
 */

import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Configuration du compte de test YC Demo (utilisé par YCDemoLogin.tsx)
const TEST_USER = {
  email: 'yc.demo@pennote.app', // Match avec YCDemoLogin.tsx
  password: 'YCDemo_Pennote_2024!', // Mot de passe pour le demo YC
  firstName: 'YC',
  lastName: 'Demo',
};

async function createTestUserFull() {
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 CRÉATION COMPTE DE TEST E2E (Clerk + DB)');
  console.log('═'.repeat(70));
  console.log(`📧 Email: ${TEST_USER.email}`);
  console.log(`🔐 Password: ${TEST_USER.password}`);
  console.log('═'.repeat(70) + '\n');

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error('❌ CLERK_SECRET_KEY manquant dans .env');
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey });

  try {
    // 1. Vérifier si l'utilisateur existe déjà dans Clerk
    console.log('🔍 Recherche dans Clerk...');
    
    const existingUsers = await clerk.users.getUserList({
      emailAddress: [TEST_USER.email],
    });

    let clerkUserId: string;

    if (existingUsers.data.length > 0) {
      clerkUserId = existingUsers.data[0].id;
      console.log(`✅ Utilisateur existe déjà dans Clerk:`);
      console.log(`   ID: ${clerkUserId}`);
      console.log(`   Email: ${existingUsers.data[0].emailAddresses[0]?.emailAddress}`);
    } else {
      // 2. Créer l'utilisateur dans Clerk
      console.log('📝 Création dans Clerk...');
      
      const clerkUser = await clerk.users.createUser({
        emailAddress: [TEST_USER.email],
        password: TEST_USER.password,
        firstName: TEST_USER.firstName,
        lastName: TEST_USER.lastName,
        skipPasswordChecks: true, // Permet un mot de passe plus simple pour les tests
      });

      clerkUserId = clerkUser.id;
      console.log(`✅ Utilisateur créé dans Clerk:`);
      console.log(`   ID: ${clerkUserId}`);
    }

    // 3. Vérifier/Créer l'utilisateur dans la DB
    console.log('\n🗄️ Synchronisation avec la DB...');
    
    let dbUser = await prisma.user.findUnique({
      where: { id: clerkUserId }
    });

    if (dbUser) {
      console.log(`✅ Utilisateur existe déjà en DB`);
    } else {
      // Supprimer l'ancien user de test s'il existe
      await prisma.user.deleteMany({
        where: { email: TEST_USER.email }
      });

      dbUser = await prisma.user.create({
        data: {
          id: clerkUserId,
          email: TEST_USER.email,
          firstName: TEST_USER.firstName,
          lastName: TEST_USER.lastName,
        }
      });
      console.log(`✅ Utilisateur créé en DB`);
    }

    // 4. Créer/Vérifier la subscription
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await prisma.userSubscription.upsert({
      where: { userId: clerkUserId },
      update: {},
      create: {
        userId: clerkUserId,
        plan: 'free_user',
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      }
    });
    console.log(`✅ Subscription OK`);

    // 5. Créer/Vérifier les limites
    await prisma.userLimits.upsert({
      where: { userId: clerkUserId },
      update: {},
      create: {
        userId: clerkUserId,
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
    console.log(`✅ Limites OK`);

    // 6. Créer un workspace de test
    const existingWorkspace = await prisma.workspace.findFirst({
      where: { ownerId: clerkUserId }
    });

    if (!existingWorkspace) {
      await prisma.workspace.create({
        data: {
          name: 'Test Workspace',
          ownerId: clerkUserId,
        }
      });
      console.log(`✅ Workspace créé`);
    } else {
      console.log(`✅ Workspace existe déjà`);
    }

    // Résumé
    console.log('\n' + '═'.repeat(70));
    console.log('✅ COMPTE DE TEST CRÉÉ AVEC SUCCÈS');
    console.log('═'.repeat(70));
    console.log(`
📧 Email: ${TEST_USER.email}
🔐 Password: ${TEST_USER.password}
🆔 Clerk ID: ${clerkUserId}

📝 Configure maintenant Playwright:

1. Crée le fichier pen-frontend/.env.local avec:

   PLAYWRIGHT_TEST_EMAIL=${TEST_USER.email}
   PLAYWRIGHT_TEST_PASSWORD=${TEST_USER.password}

2. Ou utilise Playwright codegen pour capturer la session:

   cd pen-frontend
   npx playwright codegen --save-storage=tests/e2e/.auth/user.json http://localhost:5173
`);
    console.log('═'.repeat(70) + '\n');

    return { clerkUserId, email: TEST_USER.email, password: TEST_USER.password };

  } catch (error: any) {
    console.error('❌ Erreur:', error.message || error);
    
    if (error.errors) {
      console.error('Détails:', JSON.stringify(error.errors, null, 2));
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createTestUserFull().catch(console.error);
