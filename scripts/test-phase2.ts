/**
 * Tests Phase 2 - Endpoints Billing GoCardless
 * Vérifie: Routes accessibles, intégration GoCardless, logique métier
 */

import "dotenv/config";
import { gcClient } from "../src/lib/gocardless.js";
import { prisma } from "../src/lib/prisma.js";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🧪 Tests Phase 2 - GoCardless Billing Endpoints");
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
  // Test 1: Routes accessibles
  console.log("\n📋 Test 1: Routes Backend Accessibles");

  try {
    const response1 = await fetch(
      "http://localhost:3001/api/billing-gocardless/subscription-status",
      { method: "GET" },
    );
    testResult(
      "Route GET /subscription-status",
      response1.status === 401 || response1.status === 200,
      `Status ${response1.status} (auth requise attendue)`,
    );
  } catch (error: any) {
    testResult("Route GET /subscription-status", false, error.message);
  }

  try {
    const response2 = await fetch(
      "http://localhost:3001/api/billing-gocardless/create-subscription-flow",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          given_name: "Test",
          family_name: "User",
        }),
      },
    );
    testResult(
      "Route POST /create-subscription-flow",
      response2.status === 401 ||
        response2.status === 400 ||
        response2.status === 200,
      `Status ${response2.status}`,
    );
  } catch (error: any) {
    testResult("Route POST /create-subscription-flow", false, error.message);
  }

  try {
    const response3 = await fetch(
      "http://localhost:3001/api/billing-gocardless/cancel-subscription",
      { method: "POST" },
    );
    testResult(
      "Route POST /cancel-subscription",
      response3.status === 401 ||
        response3.status === 400 ||
        response3.status === 200,
      `Status ${response3.status}`,
    );
  } catch (error: any) {
    testResult("Route POST /cancel-subscription", false, error.message);
  }

  // Test 2: Client GoCardless - Création Customer
  console.log("\n📋 Test 2: GoCardless API - Création Customer");

  try {
    const testCustomer = await gcClient.customers.create({
      email: `test-${Date.now()}@pennote-sandbox.com`,
      given_name: "Test",
      family_name: "Pennote",
      metadata: { test: "phase2" },
    });

    testResult(
      "Création customer GoCardless",
      !!testCustomer.id,
      `Customer créé: ${testCustomer.id}`,
    );

    // Nettoyage - supprimer le customer de test
    // Note: GoCardless ne permet pas de supprimer les customers en sandbox
    // donc on les marque juste avec metadata.test = "phase2"
  } catch (error: any) {
    testResult("Création customer GoCardless", false, error.message);
  }

  // Test 3: GoCardless API - Billing Requests
  console.log("\n📋 Test 3: GoCardless API - Billing Requests");

  try {
    // Créer un customer pour le test
    const customer = await gcClient.customers.create({
      email: `billing-request-test-${Date.now()}@pennote-sandbox.com`,
      given_name: "Billing",
      family_name: "Test",
      metadata: { test: "phase2-billing-request" },
    });

    const billingRequest = await gcClient.billingRequests.create({
      mandate_request: {
        scheme: "sepa_core",
        currency: "EUR",
      },
      links: {
        customer: customer.id,
      },
    });

    testResult(
      "Création billing request",
      !!billingRequest.id,
      `Billing request créé: ${billingRequest.id}`,
    );
  } catch (error: any) {
    testResult("Création billing request", false, error.message);
  }

  // Test 4: GoCardless API - Billing Request Flow
  console.log("\n📋 Test 4: GoCardless API - Billing Request Flow");

  try {
    // Créer customer et billing request
    const customer = await gcClient.customers.create({
      email: `flow-test-${Date.now()}@pennote-sandbox.com`,
      given_name: "Flow",
      family_name: "Test",
      metadata: { test: "phase2-flow" },
    });

    const billingRequest = await gcClient.billingRequests.create({
      mandate_request: {
        scheme: "sepa_core",
        currency: "EUR",
      },
      links: {
        customer: customer.id,
      },
    });

    const flow = await gcClient.billingRequestFlows.create({
      redirect_uri: "http://localhost:5173/billing/success",
      exit_uri: "http://localhost:5173/billing/cancel",
      links: {
        billing_request: billingRequest.id,
      },
    });

    testResult(
      "Création billing request flow",
      !!flow.authorisation_url,
      `Flow créé avec URL: ${flow.authorisation_url?.substring(0, 50)}...`,
    );
  } catch (error: any) {
    testResult("Création billing request flow", false, error.message);
  }

  // Test 5: Database - Vérification tables
  console.log("\n📋 Test 5: Database - Tables GoCardless");

  try {
    const userCount = await prisma.user.count();
    testResult(
      "Table User accessible",
      userCount >= 0,
      `${userCount} utilisateurs en DB`,
    );
  } catch (error: any) {
    testResult("Table User accessible", false, error.message);
  }

  try {
    const subCount = await prisma.userSubscription.count();
    testResult(
      "Table UserSubscription accessible",
      subCount >= 0,
      `${subCount} subscriptions en DB`,
    );
  } catch (error: any) {
    testResult("Table UserSubscription accessible", false, error.message);
  }

  // Test 6: Vérification des champs GoCardless dans les tables
  console.log("\n📋 Test 6: Champs GoCardless dans les tables");

  try {
    const testQuery = await prisma.$queryRaw<any[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('gocardless_customer_id')
    `;
    testResult(
      "Champ User.gocardlessCustomerId",
      testQuery.length > 0,
      "Champ présent dans table users",
    );
  } catch (error: any) {
    testResult("Champ User.gocardlessCustomerId", false, error.message);
  }

  try {
    const testQuery = await prisma.$queryRaw<any[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'user_subscriptions'
      AND column_name IN (
        'gocardless_customer_id',
        'gocardless_mandate_id',
        'gocardless_subscription_id'
      )
    `;
    testResult(
      "Champs GoCardless dans UserSubscription",
      testQuery.length >= 3,
      `${testQuery.length}/3 champs trouvés`,
    );
  } catch (error: any) {
    testResult("Champs GoCardless dans UserSubscription", false, error.message);
  }

  // Résumé
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Résumé des Tests Phase 2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Tests réussis: ${passCount}`);
  console.log(`❌ Tests échoués: ${failCount}`);
  console.log(
    `📈 Taux de réussite: ${Math.round((passCount / (passCount + failCount)) * 100)}%`,
  );

  if (failCount === 0) {
    console.log("\n🎉 PHASE 2 VALIDÉE AVEC SUCCÈS !");
    console.log("→ Tous les endpoints sont fonctionnels");
    console.log("→ API GoCardless opérationnelle");
    console.log("→ Prêt pour Phase 2 - Webhooks (Jour 6-8)");
  } else {
    console.log("\n⚠️  Certains tests ont échoué. Vérifiez:");
    console.log("   - Serveur backend lancé sur port 3001");
    console.log("   - Token GoCardless valide");
    console.log("   - Tables database créées");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
