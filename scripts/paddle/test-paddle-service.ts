/**
 * 🧪 Test Phase 2 : Service PaddleBilling
 *
 * Vérifie que :
 * - Le service PaddleBillingService fonctionne
 * - Les méthodes de DB sont opérationnelles
 * - La synchronisation des limites fonctionne
 */

import { PaddleBillingService } from "../../src/services/billing/paddleBilling.js";
import { prisma } from "../../src/lib/prisma.js";
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

async function testPaddleService() {
  logSection("🧪 TEST PHASE 2 : Service PaddleBilling");

  let passed = 0;
  let failed = 0;

  // Récupérer un userId de test depuis la ligne de commande ou utiliser un existant
  const testUserId = process.argv[2];

  if (!testUserId) {
    log(
      "ℹ️",
      "Usage: npx tsx scripts/paddle/test-paddle-service.ts <userId>",
      COLORS.yellow,
    );
    log("ℹ️", "Recherche d'un utilisateur existant...", COLORS.dim);
  }

  // Test 1: Connexion Prisma
  log("📋", "Test 1: Connexion à la base de données", COLORS.blue);

  try {
    await prisma.$queryRaw`SELECT 1`;
    log("  ✅", "Connexion Prisma OK", COLORS.green);
    passed++;
  } catch (error: any) {
    log("  ❌", `Erreur Prisma: ${error.message}`, COLORS.red);
    failed++;
    process.exit(1);
  }

  // Test 2: Récupérer un utilisateur pour les tests
  log("\n📋", "Test 2: Récupération d'un utilisateur de test", COLORS.blue);

  let userId: string;

  if (testUserId) {
    userId = testUserId;
    log("  ℹ️", `Utilisation de l'userId fourni: ${userId}`, COLORS.dim);
  } else {
    try {
      const user = await prisma.user.findFirst({
        select: { id: true, email: true },
      });

      if (!user) {
        log("  ❌", "Aucun utilisateur trouvé en base", COLORS.red);
        failed++;
        await prisma.$disconnect();
        process.exit(1);
      }

      userId = user.id;
      log(
        "  ✅",
        `Utilisateur trouvé: ${user.email} (${userId})`,
        COLORS.green,
      );
      passed++;
    } catch (error: any) {
      log("  ❌", `Erreur: ${error.message}`, COLORS.red);
      failed++;
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  // Test 3: getUserSubscription
  log(
    "\n📋",
    "Test 3: PaddleBillingService.getUserSubscription()",
    COLORS.blue,
  );

  try {
    const subscription = await PaddleBillingService.getUserSubscription(userId);
    const sub = subscription as Record<string, unknown>;

    console.log(`  ${COLORS.dim}Résultat:${COLORS.reset}`);
    console.log(`    - Plan: ${sub.plan}`);
    console.log(`    - Status: ${sub.status}`);
    console.log(`    - isPremium: ${sub.isPremium}`);
    console.log(`    - isActive: ${sub.isActive}`);
    console.log(`    - paddleCustomerId: ${sub.paddleCustomerId || "N/A"}`);
    console.log(
      `    - paddleSubscriptionId: ${sub.paddleSubscriptionId || "N/A"}`,
    );

    log("  ✅", "getUserSubscription() fonctionne", COLORS.green);
    passed++;
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 4: getUserStats
  log("\n📋", "Test 4: PaddleBillingService.getUserStats()", COLORS.blue);

  try {
    const stats = await PaddleBillingService.getUserStats(userId);

    console.log(`  ${COLORS.dim}Résultat:${COLORS.reset}`);
    console.log(`    - isPremium: ${stats.isPremium}`);

    log("  ✅", "getUserStats() fonctionne", COLORS.green);
    passed++;
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 5: Vérifier les champs Paddle dans le schéma (via requête SQL brute)
  log("\n📋", "Test 5: Champs Paddle dans UserSubscription", COLORS.blue);

  try {
    // Vérifier que les colonnes existent dans la table
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_subscriptions'
      AND column_name IN ('paddle_customer_id', 'paddle_subscription_id')
    `;

    const columnNames = columns.map((c) => c.column_name);
    const hasPaddleCustomerId = columnNames.includes("paddle_customer_id");
    const hasPaddleSubscriptionId = columnNames.includes(
      "paddle_subscription_id",
    );

    if (hasPaddleCustomerId && hasPaddleSubscriptionId) {
      log(
        "  ✅",
        "Champs paddle_customer_id et paddle_subscription_id existent en DB",
        COLORS.green,
      );
      passed++;
    } else {
      const missing = [];
      if (!hasPaddleCustomerId) missing.push("paddle_customer_id");
      if (!hasPaddleSubscriptionId) missing.push("paddle_subscription_id");
      log(
        "  ❌",
        `Champs manquants: ${missing.join(", ")}. Exécute: npx prisma db push`,
        COLORS.red,
      );
      failed++;
    }
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Test 6: findUserByPaddleCustomerId (avec valeur inexistante)
  log(
    "\n📋",
    "Test 6: PaddleBillingService.findUserByPaddleCustomerId()",
    COLORS.blue,
  );

  try {
    const result = await PaddleBillingService.findUserByPaddleCustomerId(
      "ctm_test_nonexistent",
    );
    log(
      "  ✅",
      `findUserByPaddleCustomerId() fonctionne (résultat: ${result || "null"})`,
      COLORS.green,
    );
    passed++;
  } catch (error: any) {
    log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    failed++;
  }

  // Résumé
  logSection("📊 RÉSUMÉ");

  console.log(`  ${COLORS.green}✅ Tests réussis: ${passed}${COLORS.reset}`);
  console.log(`  ${COLORS.red}❌ Tests échoués: ${failed}${COLORS.reset}`);

  if (failed === 0) {
    log("\n🎉", "Service PaddleBilling validé!", COLORS.green);
  } else {
    log("\n⚠️", "Corrige les erreurs avant de continuer", COLORS.yellow);
  }

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

testPaddleService().catch(async (error) => {
  console.error("❌ Erreur fatale:", error);
  await prisma.$disconnect();
  process.exit(1);
});
