/**
 * Provision beta users in batch
 *
 * Creates Clerk accounts + DB users + sends welcome emails with credentials.
 * Generates a unique temporary password per user.
 *
 * Usage:
 *   # Dry-run (default) — logs what would happen, sends nothing
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/provision-beta-users.ts
 *
 *   # Execute for real
 *   infisical run --env=prod --path=/Backend -- npx tsx scripts/provision-beta-users.ts --execute
 */

import { createClerkClient } from "@clerk/backend";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

// ─── Users to provision ──────────────────────────────────────
// Fill this array before running the script.
// Format: { email, firstName, lastName }
const USERS: Array<{ email: string; firstName: string; lastName: string }> = [
  // { email: "alice@example.com", firstName: "Alice", lastName: "Dupont" },
  // { email: "bob@example.com", firstName: "Bob", lastName: "Martin" },
];

// ─── Beta plan limits (same as demo user) ────────────────────
const BETA_LIMITS = {
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
  resetType: "monthly" as const,
};

// ─── Password generation ─────────────────────────────────────
function generatePassword(): string {
  const chars = randomBytes(4).toString("hex"); // 8 hex chars
  return `Pennote-${chars}!`;
}

// ─── Result tracking ─────────────────────────────────────────
interface ProvisionResult {
  email: string;
  name: string;
  password: string;
  clerkId: string;
  status: "created" | "already_exists" | "error";
  error?: string;
}

async function main(): Promise<void> {
  const isDryRun = !process.argv.includes("--execute");

  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required. Use infisical run --env=prod --path=/Backend");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Use infisical run --env=prod --path=/Backend");
  }
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required for sending welcome emails");
  }

  if (USERS.length === 0) {
    console.error("No users defined in USERS array. Edit the script first.");
    process.exit(1);
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const prisma = new PrismaClient();

  console.log("\n" + "=".repeat(70));
  console.log(isDryRun ? "  PROVISION BETA USERS (DRY RUN)" : "  PROVISION BETA USERS (EXECUTE)");
  console.log("=".repeat(70));
  console.log(`  Users to provision: ${USERS.length}`);
  if (isDryRun) {
    console.log("  Mode: DRY RUN — no changes will be made");
    console.log("  Add --execute to run for real");
  }
  console.log("=".repeat(70) + "\n");

  const results: ProvisionResult[] = [];

  for (let i = 0; i < USERS.length; i++) {
    const user = USERS[i];
    const password = generatePassword();
    const label = `[${i + 1}/${USERS.length}] ${user.email}`;

    console.log(`${label}...`);

    if (isDryRun) {
      console.log(`  -> DRY RUN: would create Clerk user + DB + send email`);
      console.log(`  -> Password would be: ${password}`);
      results.push({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        password,
        clerkId: "dry-run",
        status: "created",
      });
      continue;
    }

    try {
      // 1. Check/create Clerk user
      const existingUsers = await clerk.users.getUserList({
        emailAddress: [user.email],
      });

      let clerkUserId: string;
      let isNew = false;

      if (existingUsers.data.length > 0) {
        clerkUserId = existingUsers.data[0].id;
        console.log(`  -> Clerk: exists (${clerkUserId})`);
      } else {
        const clerkUser = await clerk.users.createUser({
          emailAddress: [user.email],
          password,
          firstName: user.firstName,
          lastName: user.lastName,
        });
        clerkUserId = clerkUser.id;
        isNew = true;
        console.log(`  -> Clerk: created (${clerkUserId})`);
      }

      // 2. Create DB user
      const existingDbUser = await prisma.user.findUnique({
        where: { id: clerkUserId },
      });

      if (!existingDbUser) {
        await prisma.user.create({
          data: {
            id: clerkUserId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            betaStatus: "active",
          },
        });
        console.log("  -> DB: user created");
      } else {
        // Ensure betaStatus is active
        await prisma.user.update({
          where: { id: clerkUserId },
          data: { betaStatus: "active" },
        });
        console.log("  -> DB: user exists, betaStatus set to active");
      }

      // 3. Subscription
      await prisma.userSubscription.upsert({
        where: { userId: clerkUserId },
        update: { plan: "premium", status: "active" },
        create: { userId: clerkUserId, plan: "premium", status: "active" },
      });

      // 4. Limits
      await prisma.userLimits.upsert({
        where: { userId: clerkUserId },
        update: {},
        create: { userId: clerkUserId, ...BETA_LIMITS },
      });

      // 5. Send welcome email (only for new users)
      if (isNew) {
        const { EmailService } = await import("../src/services/EmailService.js");
        await EmailService.sendBetaWelcome({
          to: user.email,
          name: user.firstName,
          email: user.email,
          temporaryPassword: password,
        });
        console.log("  -> Email: welcome sent");
      } else {
        console.log("  -> Email: skipped (user already existed)");
      }

      results.push({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        password: isNew ? password : "(unchanged)",
        clerkId: clerkUserId,
        status: isNew ? "created" : "already_exists",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  -> ERROR: ${message}`);
      results.push({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        password: "(failed)",
        clerkId: "(failed)",
        status: "error",
        error: message,
      });
    }
  }

  // ─── Summary ─────────────────────────────────────────────────
  const created = results.filter((r) => r.status === "created");
  const existing = results.filter((r) => r.status === "already_exists");
  const errors = results.filter((r) => r.status === "error");

  console.log("\n" + "=".repeat(70));
  console.log("  RAPPORT");
  console.log("=".repeat(70));
  console.log(`  Créés:    ${created.length}`);
  console.log(`  Existants: ${existing.length}`);
  console.log(`  Erreurs:  ${errors.length}`);
  console.log("=".repeat(70));

  if (created.length > 0) {
    console.log("\n  CREDENTIALS (à sauvegarder !):");
    console.log("  " + "-".repeat(66));
    for (const r of created) {
      console.log(`  ${r.email} | ${r.password} | ${r.clerkId}`);
    }
    console.log("  " + "-".repeat(66));
  }

  if (errors.length > 0) {
    console.log("\n  ERREURS:");
    for (const r of errors) {
      console.log(`  ${r.email}: ${r.error}`);
    }
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
