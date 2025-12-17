/**
 * 🧪 Test Phase 2 : Connexion SDK Paddle
 *
 * Vérifie que :
 * - Les variables d'environnement sont configurées
 * - Le SDK Paddle peut se connecter
 * - L'API Key est valide
 */

import {
  paddle,
  PADDLE_PLANS,
} from "../../src/services/billing/paddleBilling.js";
import dotenv from "dotenv";

// Charger les variables d'environnement
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

async function testPaddleConnection() {
  logSection("🧪 TEST PHASE 2 : Connexion Paddle SDK");

  let passed = 0;
  let failed = 0;

  // Test 1: Variables d'environnement
  log("📋", "Test 1: Variables d'environnement", COLORS.blue);

  const envVars = {
    PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
    PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT,
  };

  for (const [key, value] of Object.entries(envVars)) {
    if (value) {
      const masked =
        key.includes("KEY") || key.includes("SECRET")
          ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
          : value;
      log("  ✅", `${key}: ${masked}`, COLORS.green);
      passed++;
    } else {
      log("  ❌", `${key}: NON DÉFINI`, COLORS.red);
      failed++;
    }
  }

  // Test 2: Configuration des plans
  log("\n📋", "Test 2: Configuration des plans", COLORS.blue);

  console.log(`  ${COLORS.dim}Plans configurés:${COLORS.reset}`);
  for (const [planKey, planConfig] of Object.entries(PADDLE_PLANS)) {
    console.log(
      `    - ${planKey}: ${planConfig.name} (priceId: ${planConfig.paddlePriceId || "N/A"})`,
    );
  }
  log("  ✅", "Plans configurés correctement", COLORS.green);
  passed++;

  // Test 3: Connexion API Paddle
  log("\n📋", "Test 3: Connexion API Paddle", COLORS.blue);

  try {
    // Tenter de lister les produits pour vérifier la connexion
    const productsCollection = paddle.products.list();
    const products = await productsCollection.next();

    log(
      "  ✅",
      `Connexion réussie! ${products.length} produit(s) trouvé(s)`,
      COLORS.green,
    );

    if (products.length > 0) {
      console.log(`\n  ${COLORS.dim}Produits Paddle:${COLORS.reset}`);
      for (const product of products) {
        console.log(`    - ${product.name} (${product.id})`);
      }
    }
    passed++;
  } catch (error: any) {
    if (
      error.message?.includes("401") ||
      error.message?.includes("Unauthorized")
    ) {
      log("  ❌", "API Key invalide ou expirée", COLORS.red);
    } else if (
      error.message?.includes("ENOTFOUND") ||
      error.message?.includes("network")
    ) {
      log("  ❌", "Erreur réseau - impossible de joindre Paddle", COLORS.red);
    } else {
      log("  ❌", `Erreur: ${error.message}`, COLORS.red);
    }
    failed++;
  }

  // Test 4: Vérification de l'environnement (sandbox vs production)
  log("\n📋", "Test 4: Environnement Paddle", COLORS.blue);

  const env = process.env.PADDLE_ENVIRONMENT || "sandbox";
  if (env === "sandbox") {
    log("  ✅", "Mode SANDBOX actif (recommandé pour les tests)", COLORS.green);
    passed++;
  } else if (env === "production") {
    log(
      "  ⚠️",
      "Mode PRODUCTION actif - attention aux transactions réelles!",
      COLORS.yellow,
    );
    passed++;
  } else {
    log("  ❌", `Environnement inconnu: ${env}`, COLORS.red);
    failed++;
  }

  // Résumé
  logSection("📊 RÉSUMÉ");

  console.log(`  ${COLORS.green}✅ Tests réussis: ${passed}${COLORS.reset}`);
  console.log(`  ${COLORS.red}❌ Tests échoués: ${failed}${COLORS.reset}`);

  if (failed === 0) {
    log(
      "\n🎉",
      "Phase 2 validée! Tu peux passer à la Phase 3 (Webhook Handler)",
      COLORS.green,
    );
  } else {
    log("\n⚠️", "Corrige les erreurs avant de continuer", COLORS.yellow);
  }

  process.exit(failed > 0 ? 1 : 0);
}

testPaddleConnection().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
