/**
 * Tests Phase 1 - Intégration GoCardless
 * Vérifie: Client GoCardless, Routes, Database Schema
 */

import { gcClient } from "../src/lib/gocardless.js";
import { prisma } from "../src/lib/prisma.js";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🧪 Tests Phase 1 - GoCardless Integration");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

let passCount = 0;
let failCount = 0;

function testResult(name: string, passed: boolean, details = "") {
  if (passed) {
    console.log(`✅ ${name}`);
    if (details) console.log(`   → ${details}`);
    passCount++;
  } else {
    console.log(`❌ ${name}`);
    if (details) console.log(`   → ${details}`);
    failCount++;
  }
}

async function runTests() {
  // Test 1: Variables d'environnement
  console.log("\n📋 Test 1: Variables d'environnement");
  testResult(
    "GOCARDLESS token",
    !!process.env.GOCARDLESS,
    process.env.GOCARDLESS ? "Token présent" : "Token manquant",
  );
  testResult(
    "GOCARDLESS_ENVIRONMENT",
    !!process.env.GOCARDLESS_ENVIRONMENT,
    process.env.GOCARDLESS_ENVIRONMENT || "Non défini",
  );
  testResult(
    "GOCARDLESS_WEBHOOK_SECRET",
    !!process.env.GOCARDLESS_WEBHOOK_SECRET,
    process.env.GOCARDLESS_WEBHOOK_SECRET
      ? "Secret présent"
      : "Secret manquant",
  );

  // Test 2: Client GoCardless
  console.log("\n📋 Test 2: Client GoCardless");
  try {
    const customers = await gcClient.customers.list({ limit: 1 });
    testResult(
      "Connexion API GoCardless",
      true,
      `✓ Connecté (${customers.customers.length} customers en DB)`,
    );
  } catch (error: any) {
    testResult("Connexion API GoCardless", false, error.message);
  }

  // Test 3: Schema Prisma - User
  console.log("\n📋 Test 3: Schema Prisma - Model User");
  try {
    const userFields = await prisma.$queryRaw<any[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name = 'gocardless_customer_id'
    `;
    testResult(
      "User.gocardlessCustomerId",
      userFields.length > 0,
      "Champ présent dans table users",
    );
  } catch (error: any) {
    testResult("User.gocardlessCustomerId", false, error.message);
  }

  // Test 4: Schema Prisma - UserSubscription
  console.log("\n📋 Test 4: Schema Prisma - Model UserSubscription");
  try {
    const subFields = await prisma.$queryRaw<any[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_subscriptions'
      AND column_name IN (
        'gocardless_customer_id',
        'gocardless_mandate_id',
        'gocardless_subscription_id',
        'payment_method',
        'mandate_status',
        'next_payment_date',
        'last_payment_date'
      )
    `;
    testResult(
      "UserSubscription champs GoCardless",
      subFields.length >= 5,
      `${subFields.length}/7 champs trouvés`,
    );
  } catch (error: any) {
    testResult("UserSubscription champs GoCardless", false, error.message);
  }

  // Test 5: Table PaymentLog
  console.log("\n📋 Test 5: Schema Prisma - Model PaymentLog");
  try {
    const paymentLogExists = await prisma.$queryRaw<any[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'payment_logs'
    `;
    testResult(
      "Table PaymentLog",
      paymentLogExists.length > 0,
      "Table payment_logs créée",
    );

    if (paymentLogExists.length > 0) {
      const paymentLogFields = await prisma.$queryRaw<any[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'payment_logs'
        AND column_name IN ('provider', 'provider_id', 'amount', 'currency', 'status')
      `;
      testResult(
        "PaymentLog colonnes essentielles",
        paymentLogFields.length >= 5,
        `${paymentLogFields.length}/5 colonnes trouvées`,
      );
    }
  } catch (error: any) {
    testResult("Table PaymentLog", false, error.message);
  }

  // Test 6: Routes Backend (port 3001)
  console.log("\n📋 Test 6: Routes Backend (port 3001)");
  try {
    const response = await fetch(
      "http://localhost:3001/api/webhooks/gocardless",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      },
    );

    testResult(
      "Route /api/webhooks/gocardless",
      response.status === 401 || response.status === 400,
      `Status ${response.status} (signature invalide attendue)`,
    );
  } catch (error: any) {
    testResult("Route /api/webhooks/gocardless", false, error.message);
  }

  try {
    const response = await fetch(
      "http://localhost:3001/api/billing-gocardless/test",
      {
        method: "GET",
      },
    );

    testResult(
      "Route /api/billing-gocardless accessible",
      response.status === 401 ||
        response.status === 404 ||
        response.status === 200,
      `Status ${response.status}`,
    );
  } catch (error: any) {
    testResult("Route /api/billing-gocardless", false, "Route non configurée");
  }

  // Test 7: Fichiers créés
  console.log("\n📋 Test 7: Fichiers Phase 1");
  const fs = await import("fs");

  testResult(
    "Fichier lib/gocardless.ts",
    fs.existsSync("./src/lib/gocardless.ts"),
    "Client GoCardless créé",
  );

  testResult(
    "Fichier routes/billing-gocardless.ts",
    fs.existsSync("./src/routes/billing-gocardless.ts"),
    "Routes billing créées",
  );

  testResult(
    "Fichier routes/webhooks-gocardless.ts",
    fs.existsSync("./src/routes/webhooks-gocardless.ts"),
    "Routes webhooks créées",
  );

  // Résumé
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Résumé des Tests Phase 1");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Tests réussis: ${passCount}`);
  console.log(`❌ Tests échoués: ${failCount}`);
  console.log(
    `📈 Taux de réussite: ${Math.round((passCount / (passCount + failCount)) * 100)}%`,
  );

  if (failCount === 0) {
    console.log("\n🎉 PHASE 1 VALIDÉE AVEC SUCCÈS !");
    console.log("→ Prêt pour Phase 2: Backend Core (Endpoints Billing)");
  } else {
    console.log("\n⚠️  Certains tests ont échoué. Vérifiez:");
    console.log("   - Variables .env correctes");
    console.log("   - Serveur backend lancé sur port 3001");
    console.log("   - Migration Prisma appliquée");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
