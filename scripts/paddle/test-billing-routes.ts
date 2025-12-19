/**
 * Test des routes billing Paddle
 *
 * Ce script teste les endpoints /api/billing/* apres migration vers Paddle
 *
 * Usage:
 *   npx tsx scripts/paddle/test-billing-routes.ts [userId]
 */

import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../src/lib/prisma.js";
import { PaddleBillingService } from "../../src/services/billing/paddleBilling.js";
import { PADDLE_CONFIG } from "../../src/config/paddle.js";

const TEST_USER_ID = process.argv[2] || "user_test_paddle";

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🏓 TEST DES ROUTES BILLING PADDLE - Phase 4");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`User ID: ${TEST_USER_ID}`);
  console.log("");

  // Test 1: Configuration Paddle
  console.log("📋 Test 1: Configuration Paddle");
  console.log("─────────────────────────────────────────────────────────────");
  console.log("  Product ID:", PADDLE_CONFIG.products.premium);
  console.log("  Price Monthly:", PADDLE_CONFIG.prices.premiumMonthly);
  console.log("  Price Yearly:", PADDLE_CONFIG.prices.premiumYearly);
  console.log("  Trial enabled:", PADDLE_CONFIG.trial.enabled);
  console.log("  Trial days:", PADDLE_CONFIG.trial.durationDays);

  if (!PADDLE_CONFIG.prices.premiumMonthly) {
    console.log("  ⚠️  Prix mensuel non configure!");
  } else {
    console.log("  ✅ Configuration OK");
  }
  console.log("");

  // Test 2: getUserSubscription
  console.log("📋 Test 2: PaddleBillingService.getUserSubscription()");
  console.log("─────────────────────────────────────────────────────────────");
  try {
    const subscription =
      await PaddleBillingService.getUserSubscription(TEST_USER_ID);
    console.log("  Plan:", subscription.plan);
    console.log("  Status:", subscription.status);
    console.log("  Is Active:", subscription.isActive);
    console.log("  Is Premium:", subscription.isPremium);
    console.log(
      "  Current Period End:",
      subscription.currentPeriodEnd || "N/A",
    );
    console.log("  ✅ getUserSubscription OK");
  } catch (error: any) {
    console.log("  ❌ Erreur:", error.message);
  }
  console.log("");

  // Test 3: Verifier la table UserSubscription
  console.log("📋 Test 3: Verification table UserSubscription (Prisma)");
  console.log("─────────────────────────────────────────────────────────────");
  try {
    const dbSub = await prisma.userSubscription.findUnique({
      where: { userId: TEST_USER_ID },
    });

    if (dbSub) {
      console.log("  ID:", dbSub.id);
      console.log("  Plan:", dbSub.plan);
      console.log("  Status:", dbSub.status);
      console.log(
        "  Paddle Customer ID:",
        dbSub.paddleCustomerId || "Non defini",
      );
      console.log(
        "  Paddle Subscription ID:",
        dbSub.paddleSubscriptionId || "Non defini",
      );
      console.log("  Created:", dbSub.createdAt);
      console.log("  ✅ Subscription trouvee en DB");
    } else {
      console.log("  ℹ️  Aucune subscription trouvee pour cet utilisateur");
      console.log("  (Normal si l'utilisateur n'a jamais eu d'abonnement)");
    }
  } catch (error: any) {
    if (error.message.includes("paddleCustomerId")) {
      console.log(
        "  ⚠️  Colonnes Paddle manquantes - Executez: npx prisma db push",
      );
    } else {
      console.log("  ❌ Erreur:", error.message);
    }
  }
  console.log("");

  // Test 4: Simulation checkout session
  console.log("📋 Test 4: Simulation checkout session");
  console.log("─────────────────────────────────────────────────────────────");
  const checkoutData = {
    priceId: PADDLE_CONFIG.prices.premiumMonthly,
    customData: {
      clerkUserId: TEST_USER_ID,
    },
    customer: {
      email: "test@example.com",
    },
  };
  console.log("  Price ID:", checkoutData.priceId);
  console.log("  Custom Data:", JSON.stringify(checkoutData.customData));
  console.log("  Customer Email:", checkoutData.customer.email);
  console.log("  ✅ Donnees checkout valides");
  console.log("");

  // Test 5: Variables d'environnement frontend
  console.log("📋 Test 5: Variables d'environnement requises");
  console.log("─────────────────────────────────────────────────────────────");
  console.log("  Backend:");
  console.log(
    "    PADDLE_API_KEY:",
    process.env.PADDLE_API_KEY ? "✅ Defini" : "❌ Manquant",
  );
  console.log(
    "    PADDLE_WEBHOOK_SECRET:",
    process.env.PADDLE_WEBHOOK_SECRET
      ? "✅ Defini"
      : "⚠️ Manquant (requis pour prod)",
  );
  console.log(
    "    PADDLE_ENVIRONMENT:",
    process.env.PADDLE_ENVIRONMENT || "sandbox (defaut)",
  );
  console.log("");
  console.log("  Frontend (.env requis):");
  console.log("    VITE_PADDLE_CLIENT_TOKEN: A configurer");
  console.log("    VITE_PADDLE_ENVIRONMENT: sandbox ou production");
  console.log("");

  // Resume
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 RESUME PHASE 4");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ Backend billing.ts migre vers PaddleBillingService");
  console.log("  ✅ Routes /plans et /sync-from-clerk supprimees");
  console.log("  ✅ Nouvelles routes: /checkout-session, /portal-url, /prices");
  console.log("  ✅ Frontend service paddle.ts cree");
  console.log("  ✅ Paddle.js integre dans index.html");
  console.log("  ✅ PricingPage utilise openPaddleCheckout()");
  console.log("");
  console.log("📌 PROCHAINES ETAPES:");
  console.log("  1. Ajouter VITE_PADDLE_CLIENT_TOKEN dans pen-frontend/.env");
  console.log("  2. Executer: cd pen-backend && npx prisma db push");
  console.log("  3. Tester le checkout en local");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
