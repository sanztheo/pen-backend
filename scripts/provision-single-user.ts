/**
 * Provision a single beta user — full workflow:
 * 1. Create Clerk account with temp password
 * 2. Create DB user (betaStatus: active)
 * 3. Create subscription + limits
 * 4. Send welcome email with credentials
 *
 * Usage:
 *   infisical run --path=/Backend/PROD -- npx tsx scripts/provision-single-user.ts <email> <firstName> <lastName>
 *
 * Example:
 *   infisical run --path=/Backend/PROD -- npx tsx scripts/provision-single-user.ts alice@example.com Alice Dupont
 */

import { createClerkClient } from "@clerk/backend";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { EmailService } from "../src/services/EmailService.js";

const email = process.argv[2];
const firstName = process.argv[3] ?? "Beta";
const lastName = process.argv[4] ?? "User";

if (!email) {
  console.error("Usage: npx tsx scripts/provision-single-user.ts <email> <firstName> <lastName>");
  process.exit(1);
}

function generatePassword(): string {
  return `Pennote-${randomBytes(4).toString("hex")}!`;
}

async function main(): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY missing");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const prisma = new PrismaClient();
  const password = generatePassword();

  console.log("\n" + "=".repeat(60));
  console.log("  PROVISION BETA USER");
  console.log("=".repeat(60));
  console.log(`  Email:     ${email}`);
  console.log(`  Name:      ${firstName} ${lastName}`);
  console.log(`  Password:  ${password}`);
  console.log("=".repeat(60) + "\n");

  try {
    // ── Step 1: Clerk ──────────────────────────────────────────
    console.log("[1/4] Clerk user...");
    const existing = await clerk.users.getUserList({ emailAddress: [email] });

    let clerkUserId: string;
    let isNew = false;

    if (existing.data.length > 0) {
      clerkUserId = existing.data[0].id;
      console.log(`  -> Exists: ${clerkUserId}`);
    } else {
      const user = await clerk.users.createUser({
        emailAddress: [email],
        password,
        firstName,
        lastName,
      });
      clerkUserId = user.id;
      isNew = true;
      console.log(`  -> Created: ${clerkUserId}`);
    }

    // ── Step 2: DB user ────────────────────────────────────────
    console.log("[2/4] DB user...");
    const dbUser = await prisma.user.findUnique({ where: { id: clerkUserId } });

    if (!dbUser) {
      await prisma.user.create({
        data: {
          id: clerkUserId,
          email,
          firstName,
          lastName,
          betaStatus: "active",
        },
      });
      console.log("  -> Created in DB");
    } else {
      await prisma.user.update({
        where: { id: clerkUserId },
        data: { betaStatus: "active" },
      });
      console.log("  -> Exists, betaStatus set to active");
    }

    // ── Step 3: Subscription + Limits ──────────────────────────
    console.log("[3/4] Subscription + limits...");
    await prisma.userSubscription.upsert({
      where: { userId: clerkUserId },
      update: { plan: "premium", status: "active" },
      create: { userId: clerkUserId, plan: "premium", status: "active" },
    });

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
    console.log("  -> Premium + limits OK");

    // ── Step 4: Send welcome email ─────────────────────────────
    console.log("[4/4] Welcome email...");
    if (isNew) {
      await EmailService.sendBetaWelcome({
        to: email,
        name: firstName,
        email,
        temporaryPassword: password,
      });
      console.log("  -> Email sent!");
    } else {
      console.log("  -> Skipped (user already existed, password unchanged)");
    }

    // ── Summary ────────────────────────────────────────────────
    console.log("\n" + "=".repeat(60));
    console.log("  DONE");
    console.log("=".repeat(60));
    console.log(`  Clerk ID:  ${clerkUserId}`);
    console.log(`  Email:     ${email}`);
    console.log(`  Password:  ${isNew ? password : "(unchanged — user existed)"}`);
    console.log(`  Status:    ${isNew ? "NEW — email sent" : "EXISTING — no email"}`);
    console.log("=".repeat(60) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
