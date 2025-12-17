/**
 * Configuration Paddle Billing
 *
 * IDs des produits et prix Paddle pour Pennote
 */

export const PADDLE_CONFIG = {
  // Product IDs
  products: {
    premium: "pro_01kcnswyh52byb2wheva0rhf8w",
  },

  // Price IDs
  prices: {
    premiumMonthly: "pri_01kcnsxx3w4fwnffhk0bwj8zry", // 12€/mois
    premiumYearly: "pri_01kcnvs3cw9nm3nfv1gkw9jeep", // 144€/Annuel
  },

  // Trial configuration
  trial: {
    enabled: true,
    durationDays: 7, // Configuré dans Paddle Dashboard
  },
} as const;

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
