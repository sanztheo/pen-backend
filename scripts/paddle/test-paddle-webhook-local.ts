/**
 * 🧪 Test Phase 3 : Webhook Handler Paddle (Local)
 *
 * Ce script simule un appel webhook Paddle en local
 * pour tester le handler sans avoir besoin d'un vrai événement.
 *
 * ⚠️ Ce test ne vérifie PAS la signature (impossible sans le secret Paddle)
 * Il teste uniquement la logique de traitement des événements.
 */

import { prisma } from "../../src/lib/prisma.js";
import { PaddleBillingService } from "../../src/services/billing/paddleBilling.js";
import dotenv from "dotenv";

dotenv.config();

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(emoji: string, message: string, color = COLORS.reset) {
  console.log(`${color}${emoji} ${message}${COLORS.reset}`);
}

function logSection(title: string) {
  console.log(`\n${COLORS.cyan}${"═".repeat(50)}${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${"═".repeat(50)}${COLORS.reset}\n`);
}

async function testWebhookLogic() {
  logSection("🧪 TEST PHASE 3 : Logique Webhook Paddle");

  let passed = 0;
  let failed = 0;

  // Récupérer un userId de test
  const testUserId = process.argv[2];
  let userId: string;

  if (testUserId) {
    userId = testUserId;
    log("ℹ️", `Utilisation de l'userId fourni: ${userId}`, COLORS.dim);
  } else {
    log("ℹ️", "Recherche d'un utilisateur existant...", COLORS.dim);
    const user = await prisma.user.findFirst({
      select: { id: true, email: true },
    });
    if (!user) {
      log("❌", "Aucun utilisateur trouvé. Crée d'abord un user.", COLORS.red);
      await prisma.$disconnect();
      process.exit(1);
    }
    userId = user.id;
    log("✅", `Utilisateur trouvé: ${user.email}`, COLORS.green);
  }

  // Test 1: Simuler subscription.activated
  log("\n📋", "Test 1: Simuler subscription.activated", COLORS.blue);

  try {
    const mockPaddleCustomerId = `ctm_test_${Date.now()}`;
    const mockPaddleSubscriptionId = `sub_test_${Date.now()}`;
    const mockPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Sauvegarder l'état actuel
    const beforeSub = await prisma.userSubscription.findUnique({
      where: { userId },
    });
    const beforePlan = beforeSub?.plan || "free_user";

    console.log(`  ${COLORS.dim}État avant: plan=${beforePlan}${COLORS.reset}`);

    // Simuler l'activation premium
    await PaddleBillingService.activatePremium(
      userId,
      mockPaddleCustomerId,
      mockPaddleSubscriptionId,
      mockPeriodEnd,
    );

    // Vérifier l'état après
    const afterSub = await prisma.userSubscription.findUnique({
      where: { userId },
    });

    if (
      afterSub?.plan === "premium" &&
      afterSub?.paddleSubscriptionId === mockPaddleSubscriptionId
    ) {
      log(
        "  ✅",
        `Plan activé: ${afterSub.plan}, paddleSubId: ${afterSub.paddleSubscriptionId}`,
        COLORS.green,
      );
      passed++;
    } else {
      log("  ❌", `Activation échouée: plan=${afterSub?.plan}`, COLORS.red);
      failed++;
    }

    // Vérifier les limites
    const limits = await prisma.userLimits.findUnique({ where: { userId } });
    if (limits?.aiCreditsLimit === -1) {
      log(
        "  ✅",
        "Limites premium appliquées (aiCreditsLimit = -1)",
        COLORS.green,
      );
      passed++;
    } else {
      log(
        "  ❌",
        `Limites non mises à jour: aiCreditsLimit=${limits?.aiCreditsLimit}`,
        COLORS.red,
      );
      failed++;
    }
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 2: Simuler subscription.canceled
  log("\n📋", "Test 2: Simuler subscription.canceled", COLORS.blue);

  try {
    await PaddleBillingService.cancelSubscription(userId);

    const afterCancel = await prisma.userSubscription.findUnique({
      where: { userId },
    });

    if (
      afterCancel?.status === "canceled" &&
      afterCancel?.cancelAtPeriodEnd === true
    ) {
      log(
        "  ✅",
        `Subscription marquée pour annulation: status=${afterCancel.status}`,
        COLORS.green,
      );
      passed++;
    } else {
      log(
        "  ❌",
        `Annulation échouée: status=${afterCancel?.status}`,
        COLORS.red,
      );
      failed++;
    }
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 3: Simuler finalizeCancel (retour au free)
  log("\n📋", "Test 3: Simuler finalizeCancel (retour au free)", COLORS.blue);

  try {
    await PaddleBillingService.finalizeCancel(userId);

    const afterFinalize = await prisma.userSubscription.findUnique({
      where: { userId },
    });
    const limitsAfter = await prisma.userLimits.findUnique({
      where: { userId },
    });

    if (
      afterFinalize?.plan === "free_user" &&
      afterFinalize?.status === "active"
    ) {
      log(
        "  ✅",
        `Retour au free: plan=${afterFinalize.plan}, status=${afterFinalize.status}`,
        COLORS.green,
      );
      passed++;
    } else {
      log(
        "  ❌",
        `Retour au free échoué: plan=${afterFinalize?.plan}`,
        COLORS.red,
      );
      failed++;
    }

    if (limitsAfter?.aiCreditsLimit === 50) {
      log(
        "  ✅",
        "Limites free restaurées (aiCreditsLimit = 50)",
        COLORS.green,
      );
      passed++;
    } else {
      log(
        "  ❌",
        `Limites non restaurées: aiCreditsLimit=${limitsAfter?.aiCreditsLimit}`,
        COLORS.red,
      );
      failed++;
    }
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 4: Vérifier findUserByPaddleSubscriptionId
  log("\n📋", "Test 4: findUserByPaddleSubscriptionId", COLORS.blue);

  try {
    // D'abord réactiver pour avoir un paddleSubscriptionId
    const testSubId = `sub_test_find_${Date.now()}`;
    await PaddleBillingService.activatePremium(
      userId,
      `ctm_test_find_${Date.now()}`,
      testSubId,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    );

    const foundUserId =
      await PaddleBillingService.findUserByPaddleSubscriptionId(testSubId);

    if (foundUserId === userId) {
      log(
        "  ✅",
        `User trouvé par subscriptionId: ${foundUserId}`,
        COLORS.green,
      );
      passed++;
    } else {
      log(
        "  ❌",
        `User non trouvé: attendu ${userId}, reçu ${foundUserId}`,
        COLORS.red,
      );
      failed++;
    }

    // Cleanup : remettre en free
    await PaddleBillingService.finalizeCancel(userId);
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Résumé
  logSection("📊 RÉSUMÉ");

  console.log(`  ${COLORS.green}✅ Tests réussis: ${passed}${COLORS.reset}`);
  console.log(`  ${COLORS.red}❌ Tests échoués: ${failed}${COLORS.reset}`);

  if (failed === 0) {
    log(
      "\n🎉",
      "Logique webhook validée! Prêt pour les tests avec de vrais webhooks.",
      COLORS.green,
    );
  } else {
    log("\n⚠️", "Corrige les erreurs avant de continuer", COLORS.yellow);
  }

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

testWebhookLogic().catch(async (error) => {
  console.error("❌ Erreur fatale:", error);
  await prisma.$disconnect();
  process.exit(1);
});
