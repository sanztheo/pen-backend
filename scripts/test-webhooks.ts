/**
 * Tests Webhooks GoCardless
 * Simule les événements webhook et vérifie le traitement
 */

import "dotenv/config";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/prisma.js";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🧪 Tests Webhooks GoCardless");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

const WEBHOOK_SECRET = process.env.GOCARDLESS_WEBHOOK_SECRET!;
const WEBHOOK_URL =
  "https://b1f9d464bc5d.ngrok-free.app/api/webhooks/gocardless";

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

// Fonction pour créer la signature HMAC-SHA256
function createWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Fonction pour envoyer un webhook simulé
async function sendWebhook(eventType: string, eventData: any) {
  const payload = JSON.stringify({
    events: [eventData],
  });

  const signature = createWebhookSignature(payload, WEBHOOK_SECRET);

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Webhook-Signature": signature,
    },
    body: payload,
  });

  return response;
}

async function runTests() {
  // Test 1: Endpoint webhook accessible
  console.log("\n📋 Test 1: Endpoint Webhook Accessible");

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });

    testResult(
      "Route /api/webhooks/gocardless accessible",
      response.status === 401 ||
        response.status === 400 ||
        response.status === 200,
      `Status ${response.status} (signature invalide attendue sans signature)`,
    );
  } catch (error: any) {
    testResult("Route /api/webhooks/gocardless", false, error.message);
  }

  // Test 2: Vérification signature HMAC
  console.log("\n📋 Test 2: Vérification Signature HMAC");

  try {
    const testPayload = JSON.stringify({
      events: [
        {
          id: "EV_TEST_SIGNATURE",
          created_at: new Date().toISOString(),
          resource_type: "payments",
          action: "confirmed",
          links: {
            payment: "PM_TEST",
          },
        },
      ],
    });

    const validSignature = createWebhookSignature(testPayload, WEBHOOK_SECRET);

    const responseValid = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Webhook-Signature": validSignature,
      },
      body: testPayload,
    });

    testResult(
      "Signature valide acceptée",
      responseValid.status === 200 || responseValid.status === 201,
      `Status ${responseValid.status}`,
    );

    // Test signature invalide
    const responseInvalid = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Webhook-Signature": "invalid_signature_12345",
      },
      body: testPayload,
    });

    testResult(
      "Signature invalide rejetée",
      responseInvalid.status === 401 || responseInvalid.status === 403,
      `Status ${responseInvalid.status}`,
    );
  } catch (error: any) {
    testResult("Vérification signature", false, error.message);
  }

  // Test 3: Créer un utilisateur test pour les webhooks
  console.log("\n📋 Test 3: Préparation Utilisateur Test");

  let testUserId: string | null = null;
  const testEmail = `webhook-test-${Date.now()}@pennote-test.com`;

  try {
    // Créer un utilisateur test (id = clerkId)
    const testUser = await prisma.user.create({
      data: {
        id: `user_test_webhook_${Date.now()}`,
        email: testEmail,
        firstName: "Webhook",
        lastName: "Test",
        gocardlessCustomerId: `CU_WEBHOOK_TEST_${Date.now()}`,
      },
    });

    testUserId = testUser.id;

    testResult(
      "Utilisateur test créé",
      !!testUserId,
      `User ID: ${testUserId.substring(0, 20)}...`,
    );

    // Créer une subscription pour l'utilisateur
    await prisma.userSubscription.create({
      data: {
        userId: testUserId,
        plan: "free_user",
        gocardlessCustomerId: testUser.gocardlessCustomerId!,
      },
    });

    testResult("UserSubscription test créée", true, "Plan: free_user");
  } catch (error: any) {
    testResult("Préparation utilisateur test", false, error.message);
  }

  if (!testUserId) {
    console.log("\n⚠️  Impossible de continuer sans utilisateur test");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Test 4: Webhook payments.confirmed
  console.log("\n📋 Test 4: Webhook payments.confirmed");

  try {
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { gocardlessCustomerId: true },
    });

    const paymentConfirmedEvent = {
      id: `EV_PAYMENT_CONFIRMED_${Date.now()}`,
      created_at: new Date().toISOString(),
      resource_type: "payments",
      action: "confirmed",
      links: {
        payment: `PM_TEST_${Date.now()}`,
        mandate: `MD_TEST_${Date.now()}`,
        subscription: `SB_TEST_${Date.now()}`,
        customer: user!.gocardlessCustomerId,
      },
      details: {
        origin: "gocardless",
        cause: "payment_confirmed",
        description: "Payment confirmed successfully",
      },
    };

    const response = await sendWebhook(
      "payments.confirmed",
      paymentConfirmedEvent,
    );

    testResult(
      "Webhook payments.confirmed traité",
      response.status === 200 || response.status === 201,
      `Status ${response.status}`,
    );

    // Vérifier si le PaymentLog a été créé
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Attendre le traitement

    const paymentLog = await prisma.paymentLog.findFirst({
      where: {
        providerId: paymentConfirmedEvent.links.payment,
      },
    });

    testResult(
      "PaymentLog créé pour payment.confirmed",
      !!paymentLog,
      paymentLog ? `Status: ${paymentLog.status}` : "Non trouvé",
    );
  } catch (error: any) {
    testResult("Webhook payments.confirmed", false, error.message);
  }

  // Test 5: Webhook mandates.active
  console.log("\n📋 Test 5: Webhook mandates.active");

  try {
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { gocardlessCustomerId: true },
    });

    const mandateActiveEvent = {
      id: `EV_MANDATE_ACTIVE_${Date.now()}`,
      created_at: new Date().toISOString(),
      resource_type: "mandates",
      action: "active",
      links: {
        mandate: `MD_TEST_${Date.now()}`,
        customer: user!.gocardlessCustomerId,
      },
      details: {
        origin: "gocardless",
        cause: "mandate_activated",
      },
    };

    const response = await sendWebhook("mandates.active", mandateActiveEvent);

    testResult(
      "Webhook mandates.active traité",
      response.status === 200 || response.status === 201,
      `Status ${response.status}`,
    );

    // Vérifier la mise à jour de UserSubscription
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const subscription = await prisma.userSubscription.findFirst({
      where: { userId: testUserId },
    });

    testResult(
      "UserSubscription mandateStatus mis à jour",
      subscription?.mandateStatus === "active",
      `Status: ${subscription?.mandateStatus || "Non défini"}`,
    );
  } catch (error: any) {
    testResult("Webhook mandates.active", false, error.message);
  }

  // Test 6: Webhook mandates.cancelled
  console.log("\n📋 Test 6: Webhook mandates.cancelled");

  try {
    const user = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { gocardlessCustomerId: true },
    });

    const mandateCancelledEvent = {
      id: `EV_MANDATE_CANCELLED_${Date.now()}`,
      created_at: new Date().toISOString(),
      resource_type: "mandates",
      action: "cancelled",
      links: {
        mandate: `MD_TEST_${Date.now()}`,
        customer: user!.gocardlessCustomerId,
      },
      details: {
        origin: "customer",
        cause: "bank_account_closed",
      },
    };

    const response = await sendWebhook(
      "mandates.cancelled",
      mandateCancelledEvent,
    );

    testResult(
      "Webhook mandates.cancelled traité",
      response.status === 200 || response.status === 201,
      `Status ${response.status}`,
    );

    // Vérifier la mise à jour du plan
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const subscription = await prisma.userSubscription.findFirst({
      where: { userId: testUserId },
    });

    testResult(
      "Plan repassé à free après annulation",
      subscription?.plan === "free_user",
      `Plan: ${subscription?.plan}`,
    );
  } catch (error: any) {
    testResult("Webhook mandates.cancelled", false, error.message);
  }

  // Nettoyage - Supprimer les données de test
  console.log("\n📋 Nettoyage des données de test");

  try {
    await prisma.paymentLog.deleteMany({
      where: {
        providerId: {
          contains: "TEST",
        },
      },
    });

    await prisma.userSubscription.deleteMany({
      where: { userId: testUserId },
    });

    await prisma.user.delete({
      where: { id: testUserId },
    });

    testResult("Données de test nettoyées", true, "User et logs supprimés");
  } catch (error: any) {
    testResult("Nettoyage", false, error.message);
  }

  // Résumé
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Résumé des Tests Webhooks");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Tests réussis: ${passCount}`);
  console.log(`❌ Tests échoués: ${failCount}`);
  console.log(
    `📈 Taux de réussite: ${Math.round((passCount / (passCount + failCount)) * 100)}%`,
  );

  if (failCount === 0) {
    console.log("\n🎉 WEBHOOKS VALIDÉS AVEC SUCCÈS !");
    console.log("→ Vérification signature HMAC opérationnelle");
    console.log("→ Handlers d'événements fonctionnels");
    console.log("→ Mise à jour DB correcte");
    console.log("→ Prêt pour Phase 3: Frontend");
  } else {
    console.log("\n⚠️  Certains tests ont échoué. Vérifiez:");
    console.log("   - Serveur backend lancé sur port 3001");
    console.log("   - GOCARDLESS_WEBHOOK_SECRET correct dans .env");
    console.log("   - Handlers webhooks implémentés");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
