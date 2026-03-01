/**
 * Seed script for testing Phase 9 — Admin Beta Dashboard
 *
 * Creates 8 fake beta users with different statuses + sets demo@pennote.app as admin.
 * Run: npx tsx scripts/seed-beta-test-data.ts
 * Cleanup: npx tsx scripts/seed-beta-test-data.ts --cleanup
 */

import { PrismaClient, BetaStatus } from "@prisma/client";

const prisma = new PrismaClient();

const FAKE_USER_PREFIX = "fake_beta_";
const ADMIN_EMAIL = "demo@pennote.app";

const now = new Date();
const daysAgo = (d: number): Date => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
const hoursAgo = (h: number): Date => new Date(now.getTime() - h * 60 * 60 * 1000);

interface FakeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  betaStatus: BetaStatus;
  betaJoinedAt: Date | null;
  betaDeactivatedAt: Date | null;
  betaReactivationDeadline: Date | null;
  lastHeartbeatAt: Date | null;
  lastActiveAt: Date | null;
  totalActiveTimeSeconds: number;
  weeklyActiveTimeSeconds: number;
  weeklySessionCount: number;
}

const FAKE_USERS: FakeUser[] = [
  {
    id: `${FAKE_USER_PREFIX}active_1`,
    email: "alice.martin@test.pennote.app",
    firstName: "Alice",
    lastName: "Martin",
    betaStatus: "active",
    betaJoinedAt: daysAgo(30),
    betaDeactivatedAt: null,
    betaReactivationDeadline: null,
    lastHeartbeatAt: hoursAgo(1),
    lastActiveAt: hoursAgo(1),
    totalActiveTimeSeconds: 7200,
    weeklyActiveTimeSeconds: 3600,
    weeklySessionCount: 12,
  },
  {
    id: `${FAKE_USER_PREFIX}active_2`,
    email: "bob.dupont@test.pennote.app",
    firstName: "Bob",
    lastName: "Dupont",
    betaStatus: "active",
    betaJoinedAt: daysAgo(20),
    betaDeactivatedAt: null,
    betaReactivationDeadline: null,
    lastHeartbeatAt: daysAgo(5),
    lastActiveAt: daysAgo(5),
    totalActiveTimeSeconds: 1800,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 2,
  },
  {
    id: `${FAKE_USER_PREFIX}inactive_1`,
    email: "claire.moreau@test.pennote.app",
    firstName: "Claire",
    lastName: "Moreau",
    betaStatus: "inactive",
    betaJoinedAt: daysAgo(25),
    betaDeactivatedAt: daysAgo(3),
    betaReactivationDeadline: daysAgo(-11), // 11 jours restants
    lastHeartbeatAt: daysAgo(10),
    lastActiveAt: daysAgo(10),
    totalActiveTimeSeconds: 5400,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
  {
    id: `${FAKE_USER_PREFIX}inactive_2`,
    email: "david.leroy@test.pennote.app",
    firstName: "David",
    lastName: "Leroy",
    betaStatus: "inactive",
    betaJoinedAt: daysAgo(40),
    betaDeactivatedAt: daysAgo(12),
    betaReactivationDeadline: daysAgo(2), // deadline passee
    lastHeartbeatAt: daysAgo(20),
    lastActiveAt: daysAgo(20),
    totalActiveTimeSeconds: 900,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
  {
    id: `${FAKE_USER_PREFIX}expired_1`,
    email: "emma.petit@test.pennote.app",
    firstName: "Emma",
    lastName: "Petit",
    betaStatus: "expired",
    betaJoinedAt: daysAgo(60),
    betaDeactivatedAt: daysAgo(21),
    betaReactivationDeadline: daysAgo(7),
    lastHeartbeatAt: daysAgo(30),
    lastActiveAt: daysAgo(30),
    totalActiveTimeSeconds: 3600,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
  {
    id: `${FAKE_USER_PREFIX}waitlist_1`,
    email: "fabien.garcia@test.pennote.app",
    firstName: "Fabien",
    lastName: "Garcia",
    betaStatus: "waitlist",
    betaJoinedAt: null,
    betaDeactivatedAt: null,
    betaReactivationDeadline: null,
    lastHeartbeatAt: null,
    lastActiveAt: null,
    totalActiveTimeSeconds: 0,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
  {
    id: `${FAKE_USER_PREFIX}waitlist_2`,
    email: "gabrielle.roux@test.pennote.app",
    firstName: "Gabrielle",
    lastName: "Roux",
    betaStatus: "waitlist",
    betaJoinedAt: null,
    betaDeactivatedAt: null,
    betaReactivationDeadline: null,
    lastHeartbeatAt: null,
    lastActiveAt: null,
    totalActiveTimeSeconds: 0,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
  {
    id: `${FAKE_USER_PREFIX}pending_1`,
    email: "hugo.bernard@test.pennote.app",
    firstName: "Hugo",
    lastName: "Bernard",
    betaStatus: "pending_reactivation",
    betaJoinedAt: daysAgo(35),
    betaDeactivatedAt: daysAgo(7),
    betaReactivationDeadline: daysAgo(-7), // 7 jours restants
    lastHeartbeatAt: daysAgo(14),
    lastActiveAt: daysAgo(14),
    totalActiveTimeSeconds: 2700,
    weeklyActiveTimeSeconds: 0,
    weeklySessionCount: 0,
  },
];

const WAITLIST_ENTRIES = [
  {
    email: "fabien.garcia@test.pennote.app",
    userId: `${FAKE_USER_PREFIX}waitlist_1`,
    name: "Fabien Garcia",
    joinedAt: daysAgo(5),
  },
  {
    email: "gabrielle.roux@test.pennote.app",
    userId: `${FAKE_USER_PREFIX}waitlist_2`,
    name: "Gabrielle Roux",
    joinedAt: daysAgo(15),
  },
];

async function seed(): Promise<void> {
  console.log("--- Beta Test Data Seed ---\n");

  // 1. Set admin
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    console.error(`[ERROR] Admin user ${ADMIN_EMAIL} not found in DB. Log in first.`);
    process.exit(1);
  }

  if (!admin.isAdmin) {
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: { isAdmin: true },
    });
    console.log(`[ADMIN] ${ADMIN_EMAIL} -> isAdmin = true`);
  } else {
    console.log(`[ADMIN] ${ADMIN_EMAIL} already admin`);
  }

  // 2. Create fake users
  for (const user of FAKE_USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        betaStatus: user.betaStatus,
        betaJoinedAt: user.betaJoinedAt,
        betaDeactivatedAt: user.betaDeactivatedAt,
        betaReactivationDeadline: user.betaReactivationDeadline,
        lastHeartbeatAt: user.lastHeartbeatAt,
        lastActiveAt: user.lastActiveAt,
        totalActiveTimeSeconds: user.totalActiveTimeSeconds,
        weeklyActiveTimeSeconds: user.weeklyActiveTimeSeconds,
        weeklySessionCount: user.weeklySessionCount,
      },
      create: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        betaStatus: user.betaStatus,
        betaJoinedAt: user.betaJoinedAt,
        betaDeactivatedAt: user.betaDeactivatedAt,
        betaReactivationDeadline: user.betaReactivationDeadline,
        lastHeartbeatAt: user.lastHeartbeatAt,
        lastActiveAt: user.lastActiveAt,
        totalActiveTimeSeconds: user.totalActiveTimeSeconds,
        weeklyActiveTimeSeconds: user.weeklyActiveTimeSeconds,
        weeklySessionCount: user.weeklySessionCount,
      },
    });
    console.log(`[USER] ${user.firstName} ${user.lastName} (${user.betaStatus})`);
  }

  // 3. Create waitlist entries
  for (const entry of WAITLIST_ENTRIES) {
    await prisma.betaWaitlist.upsert({
      where: { email: entry.email },
      update: { joinedAt: entry.joinedAt },
      create: entry,
    });
    console.log(`[WAITLIST] ${entry.name} (joined ${entry.joinedAt.toISOString().split("T")[0]})`);
  }

  console.log("\n--- Done! 8 fake users + 2 waitlist entries created ---");
  console.log("Go to http://localhost:5173/admin and click the Beta tab");
}

async function cleanup(): Promise<void> {
  console.log("--- Cleaning up beta test data ---\n");

  // Remove waitlist entries
  const deletedWaitlist = await prisma.betaWaitlist.deleteMany({
    where: { email: { contains: "@test.pennote.app" } },
  });
  console.log(`[WAITLIST] Deleted ${deletedWaitlist.count} entries`);

  // Remove fake users
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { startsWith: FAKE_USER_PREFIX } },
  });
  console.log(`[USERS] Deleted ${deletedUsers.count} fake users`);

  // Keep admin as is (don't remove admin status)
  console.log(`[ADMIN] ${ADMIN_EMAIL} admin status kept (use set-admin.ts to change)`);

  console.log("\n--- Cleanup done ---");
}

const isCleanup = process.argv.includes("--cleanup");

(isCleanup ? cleanup() : seed())
  .catch((e) => {
    console.error("[ERROR]", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
