/**
 * Script de création d'un compte demo
 *
 * Crée un utilisateur dans Clerk + DB avec workspace, subscription et limites.
 * Le user sera prêt à se connecter et tester l'onboarding beta (0/4 steps).
 *
 * Usage: infisical run --env=dev --path=/Backend -- npx tsx scripts/setup/create-demo-user.ts
 */

import { createClerkClient } from "@clerk/backend";
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";

dotenv.config();

const DEMO_EMAIL = "demo@pennote.app";
const DEMO_PASSWORD = "Demo2026!Pennote";
const DEMO_FIRST_NAME = "Demo";
const DEMO_LAST_NAME = "User";

async function createDemoUser(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY manquant. Lance avec: infisical run --env=dev --path=/Backend -- npx tsx scripts/setup/create-demo-user.ts",
    );
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquant.");
  }

  const clerk = createClerkClient({ secretKey });
  const prisma = new PrismaClient();

  console.log("\n" + "=".repeat(60));
  console.log("CREATION COMPTE DEMO");
  console.log("=".repeat(60));

  try {
    // 1. Vérifier si le user existe déjà dans Clerk
    const existingUsers = await clerk.users.getUserList({
      emailAddress: [DEMO_EMAIL],
    });

    let clerkUserId: string;

    if (existingUsers.totalCount > 0) {
      clerkUserId = existingUsers.data[0].id;
      console.log(`Clerk: user existe deja (${clerkUserId})`);
    } else {
      const clerkUser = await clerk.users.createUser({
        emailAddress: [DEMO_EMAIL],
        password: DEMO_PASSWORD,
        firstName: DEMO_FIRST_NAME,
        lastName: DEMO_LAST_NAME,
      });
      clerkUserId = clerkUser.id;
      console.log(`Clerk: user cree (${clerkUserId})`);
    }

    // 2. Upsert user en DB
    const existingDbUser = await prisma.user.findUnique({
      where: { id: clerkUserId },
    });

    if (existingDbUser) {
      console.log("DB: user existe deja");
    } else {
      await prisma.user.create({
        data: {
          id: clerkUserId,
          email: DEMO_EMAIL,
          firstName: DEMO_FIRST_NAME,
          lastName: DEMO_LAST_NAME,
          betaStatus: "active",
        },
      });
      console.log("DB: user cree");
    }

    // 3. Subscription premium (beta)
    await prisma.userSubscription.upsert({
      where: { userId: clerkUserId },
      update: { plan: "premium", status: "active" },
      create: {
        userId: clerkUserId,
        plan: "premium",
        status: "active",
      },
    });
    console.log("DB: subscription premium active");

    // 4. Limites
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
        lastResetAt: new Date(),
        resetType: "monthly",
      },
    });
    console.log("DB: limites creees");

    // 5. Workspace par défaut
    const existingWorkspace = await prisma.workspace.findFirst({
      where: { ownerId: clerkUserId },
    });

    if (!existingWorkspace) {
      await prisma.workspace.create({
        data: {
          name: "Demo Workspace",
          ownerId: clerkUserId,
          color: "#3B82F6",
        },
      });
      console.log("DB: workspace cree");
    } else {
      console.log("DB: workspace existe deja");
    }

    // Résumé
    console.log("\n" + "=".repeat(60));
    console.log("COMPTE DEMO PRET");
    console.log("=".repeat(60));
    console.log(`Email:    ${DEMO_EMAIL}`);
    console.log(`Password: ${DEMO_PASSWORD}`);
    console.log(`Clerk ID: ${clerkUserId}`);
    console.log(`Beta:     active (0/4 onboarding steps)`);
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("Erreur:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createDemoUser().catch(console.error);
