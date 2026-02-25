/**
 * Script de creation d'un compte de test PREMIUM en production
 *
 * Cree l'utilisateur sur Clerk + DB avec subscription premium et limites illimitees.
 *
 * Usage:
 *   cd pen-backend
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/setup/create-premium-test-user.ts
 *
 * Ou avec un mot de passe custom:
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/setup/create-premium-test-user.ts --password=MonMotDePasse123!
 */

import { createClerkClient } from "@clerk/backend";
import { PrismaClient } from "@prisma/client";

const EMAIL = "test@pennote.app";
const FIRST_NAME = "Test";
const LAST_NAME = "Premium";
const DEFAULT_PASSWORD = "PennoteTest2026!";

function getPassword(): string {
  const passwordArg = process.argv.find((arg) => arg.startsWith("--password="));
  if (passwordArg) {
    return passwordArg.split("=").slice(1).join("=");
  }
  return DEFAULT_PASSWORD;
}

async function main(): Promise<void> {
  // Validate env vars - fail fast
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "CLERK_SECRET_KEY is required. Use infisical run --env=prod --path=/Backend",
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Use infisical run --env=prod --path=/Backend",
    );
  }

  const password = getPassword();
  const prisma = new PrismaClient();
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  console.log("\n" + "=".repeat(70));
  console.log("  CREATION COMPTE TEST PREMIUM (PROD)");
  console.log("=".repeat(70));
  console.log(`  Email:    ${EMAIL}`);
  console.log(
    `  Password: ${password.slice(0, 3)}${"*".repeat(password.length - 3)}`,
  );
  console.log("=".repeat(70) + "\n");

  try {
    // ── Step 1: Create or find Clerk user ──────────────────────────────
    console.log("[1/4] Clerk user...");

    let clerkUserId: string;

    // Check if user already exists on Clerk
    const existingClerkUsers = await clerk.users.getUserList({
      emailAddress: [EMAIL],
    });

    if (existingClerkUsers.data.length > 0) {
      const existing = existingClerkUsers.data[0];
      clerkUserId = existing.id;
      console.log(`  -> Existe deja: ${clerkUserId}`);
    } else {
      const newUser = await clerk.users.createUser({
        emailAddress: [EMAIL],
        password,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      });
      clerkUserId = newUser.id;
      console.log(`  -> Cree: ${clerkUserId}`);
    }

    // ── Step 2: Create or find DB user ─────────────────────────────────
    console.log("[2/4] DB user...");

    const existingDbUser = await prisma.user.findUnique({
      where: { id: clerkUserId },
    });

    if (existingDbUser) {
      console.log(`  -> Existe deja en DB: ${existingDbUser.email}`);
    } else {
      // Check if email exists with different ID (leftover)
      const emailUser = await prisma.user.findUnique({
        where: { email: EMAIL },
      });

      if (emailUser) {
        console.log(
          `  -> Email existe avec ID different (${emailUser.id}), suppression...`,
        );
        await prisma.user.delete({ where: { id: emailUser.id } });
      }

      await prisma.user.create({
        data: {
          id: clerkUserId,
          email: EMAIL,
          firstName: FIRST_NAME,
          lastName: LAST_NAME,
          onboardingCompleted: true,
          betaStatus: "active",
        },
      });
      console.log("  -> Cree en DB");
    }

    // ── Step 3: Set premium subscription ───────────────────────────────
    console.log("[3/4] Subscription premium...");

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setFullYear(periodEnd.getFullYear() + 10); // 10 ans

    await prisma.userSubscription.upsert({
      where: { userId: clerkUserId },
      update: {
        plan: "premium",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
      create: {
        userId: clerkUserId,
        plan: "premium",
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
    console.log(
      `  -> Premium actif jusqu'au ${periodEnd.toLocaleDateString("fr-FR")}`,
    );

    // ── Step 4: Set unlimited limits ───────────────────────────────────
    console.log("[4/4] Limites illimitees...");

    await prisma.userLimits.upsert({
      where: { userId: clerkUserId },
      update: {
        aiCreditsLimit: -1,
        workspacesLimit: -1,
        projectsLimit: -1,
        customQuizzesLimit: -1,
        presetSequencesLimit: -1,
        historyQuizzesLimit: -1,
        pagesSelectionLimit: -1,
        questionsPerQuizLimit: -1,
        advancedQuizzesLimit: -1,
        pagesLimit: -1,
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
        pagesUsed: 0,
        lastResetAt: now,
      },
      create: {
        userId: clerkUserId,
        aiCreditsLimit: -1,
        workspacesLimit: -1,
        projectsLimit: -1,
        customQuizzesLimit: -1,
        presetSequencesLimit: -1,
        historyQuizzesLimit: -1,
        pagesSelectionLimit: -1,
        questionsPerQuizLimit: -1,
        advancedQuizzesLimit: -1,
        pagesLimit: -1,
        aiCreditsUsed: 0,
        workspacesUsed: 0,
        projectsUsed: 0,
        customQuizzesUsed: 0,
        presetSequencesUsed: 0,
        advancedQuizzesUsed: 0,
        pagesUsed: 0,
        lastResetAt: now,
        resetType: "monthly",
      },
    });
    console.log("  -> Toutes limites = illimite (-1)");

    // ── Summary ────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(70));
    console.log("  COMPTE TEST CREE AVEC SUCCES");
    console.log("=".repeat(70));
    console.log(`  Clerk ID:  ${clerkUserId}`);
    console.log(`  Email:     ${EMAIL}`);
    console.log(`  Password:  ${password}`);
    console.log(`  Plan:      Premium (illimite)`);
    console.log(`  Expire:    ${periodEnd.toLocaleDateString("fr-FR")}`);
    console.log("=".repeat(70) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
