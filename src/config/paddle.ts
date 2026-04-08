/**
 * Configuration Paddle Billing
 *
 * IDs des produits et prix Paddle pour Pennote (3-tier: Free/Pro/Ultra)
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
  // Environment - MUST be set in Infisical, no fallback
  environment: requireEnv("PADDLE_ENVIRONMENT"),

  // Product IDs
  products: {
    premium: requireEnv("PRODUCT"),
    ultra: requireEnv("ULTRAPRODUCT"),
  },

  // Price IDs
  prices: {
    premiumMonthly: requireEnv("PREMIUMMONTHLY"),
    premiumYearly: requireEnv("PREMIUMYEARLY"),
    ultraMonthly: requireEnv("ULTRAMONTHLY"),
    ultraYearly: requireEnv("ULTRAYEARLY"),
  },

  // Trial configuration (Ultra has no trial — payment upfront)
  trial: {
    enabled: true,
    durationDays: 7,
  },
};

/** Vérifie si un product ID correspond au plan Pro (premium) */
export function isPremiumProduct(productId: string): boolean {
  return productId === PADDLE_CONFIG.products.premium;
}

/** Vérifie si un product ID correspond au plan Ultra */
export function isUltraProduct(productId: string): boolean {
  return productId !== "" && productId === PADDLE_CONFIG.products.ultra;
}

/** Vérifie si un price ID correspond au plan Pro (premium) */
export function isPremiumPrice(priceId: string): boolean {
  return (
    priceId === PADDLE_CONFIG.prices.premiumMonthly ||
    priceId === PADDLE_CONFIG.prices.premiumYearly
  );
}

/** Vérifie si un price ID correspond au plan Ultra */
export function isUltraPrice(priceId: string): boolean {
  return (
    priceId !== "" &&
    (priceId === PADDLE_CONFIG.prices.ultraMonthly || priceId === PADDLE_CONFIG.prices.ultraYearly)
  );
}

/** Map un Paddle product ID vers un SubscriptionPlan. */
export function getPlanFromProductId(productId: string): "free_user" | "premium" | "ultra" {
  if (isPremiumProduct(productId)) return "premium";
  if (isUltraProduct(productId)) return "ultra";
  return "free_user";
}
