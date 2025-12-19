/**
 * Configuration Paddle Billing
 *
 * IDs des produits et prix Paddle pour Pennote
 * Les IDs sont chargés depuis les variables d'environnement
 * - PADDLE_ENVIRONMENT=sandbox → clés sandbox (.env.dev)
 * - PADDLE_ENVIRONMENT=production → clés production (.env.prod)
 */

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Variable Paddle manquante: ${name}`);
  }
  return value;
};

export const PADDLE_CONFIG = {
  // Environment
  environment: process.env.PADDLE_ENVIRONMENT || "sandbox",

  // Product IDs (depuis .env)
  products: {
    premium: requireEnv("PRODUCT"),
  },

  // Price IDs (depuis .env)
  prices: {
    premiumMonthly: requireEnv("PREMIUMMONTHLY"),
    premiumYearly: requireEnv("PREMIUMYEARLY"),
  },

  // Trial configuration
  trial: {
    enabled: true,
    durationDays: 7,
  },
};

/**
 * Vérifie si un product ID correspond à un plan premium
 */
export function isPremiumProduct(productId: string): boolean {
  return productId === PADDLE_CONFIG.products.premium;
}

/**
 * Vérifie si un price ID correspond à un plan premium
 */
export function isPremiumPrice(priceId: string): boolean {
  return (
    priceId === PADDLE_CONFIG.prices.premiumMonthly ||
    priceId === PADDLE_CONFIG.prices.premiumYearly
  );
}
