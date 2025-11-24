/**
 * Script de debug pour comprendre les échecs de tests webhooks
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function debug() {
  console.log("🔍 Analyse des problèmes de tests webhooks\n");

  // 1. Vérifier les UserSubscriptions récentes
  console.log("📋 UserSubscriptions récentes:");
  const recentSubs = await prisma.userSubscription.findMany({
    take: 3,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, email: true, gocardlessCustomerId: true } },
    },
  });

  recentSubs.forEach((sub) => {
    console.log(`  - User: ${sub.user.id.substring(0, 20)}...`);
    console.log(`    Plan: ${sub.plan}`);
    console.log(
      `    Sub.gocardlessCustomerId: ${sub.gocardlessCustomerId || "❌ VIDE"}`,
    );
    console.log(
      `    User.gocardlessCustomerId: ${sub.user.gocardlessCustomerId || "❌ VIDE"}`,
    );
    console.log(`    mandateStatus: ${sub.mandateStatus || "❌ Non défini"}`);
    console.log();
  });

  // 2. Vérifier les PaymentLogs récents
  console.log("💳 PaymentLogs récents:");
  const recentLogs = await prisma.paymentLog.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  if (recentLogs.length === 0) {
    console.log("  ❌ Aucun PaymentLog trouvé\n");
  } else {
    recentLogs.forEach((log) => {
      console.log(`  - User: ${log.userId?.substring(0, 20) || "N/A"}...`);
      console.log(`    Provider: ${log.provider}`);
      console.log(`    ProviderId: ${log.providerId}`);
      console.log(`    Status: ${log.status}`);
      console.log();
    });
  }

  // 3. Test de findUserByGocardlessCustomer
  console.log("🔍 Test findUserByGocardlessCustomer:");
  const testCustomerId = "CU_WEBHOOK_TEST_123";

  // Créer un user test
  const testUser = await prisma.user.create({
    data: {
      id: `debug_user_${Date.now()}`,
      email: `debug-${Date.now()}@test.com`,
      firstName: "Debug",
      lastName: "Test",
      gocardlessCustomerId: testCustomerId,
    },
  });
  console.log(`  ✅ User créé avec gocardlessCustomerId: ${testCustomerId}`);

  // Créer une subscription
  await prisma.userSubscription.create({
    data: {
      userId: testUser.id,
      plan: "free_user",
      gocardlessCustomerId: testCustomerId,
    },
  });
  console.log(
    `  ✅ UserSubscription créée avec gocardlessCustomerId: ${testCustomerId}`,
  );

  // Tester la recherche
  const foundSub = await prisma.userSubscription.findFirst({
    where: { gocardlessCustomerId: testCustomerId },
    include: { user: true },
  });

  if (foundSub) {
    console.log(`  ✅ User trouvé via findFirst: ${foundSub.user.id}`);
  } else {
    console.log(`  ❌ User NON trouvé via findFirst!`);
  }

  // Nettoyage
  await prisma.userSubscription.delete({ where: { userId: testUser.id } });
  await prisma.user.delete({ where: { id: testUser.id } });
  console.log(`  🧹 Nettoyage effectué\n`);

  await prisma.$disconnect();
}

debug().catch(console.error);
