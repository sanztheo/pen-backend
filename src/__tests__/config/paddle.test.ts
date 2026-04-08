import { describe, it, expect } from "vitest";
import {
  PADDLE_CONFIG,
  isPremiumProduct,
  isUltraProduct,
  isUltraPrice,
  getPlanFromProductId,
} from "../../config/paddle.js";

describe("Paddle Config — 3-tier", () => {
  it("should have ultra product config", () => {
    expect(PADDLE_CONFIG.products).toHaveProperty("ultra");
  });

  it("should have ultra monthly and yearly prices", () => {
    expect(PADDLE_CONFIG.prices).toHaveProperty("ultraMonthly");
    expect(PADDLE_CONFIG.prices).toHaveProperty("ultraYearly");
  });

  it("isPremiumProduct returns true for premium product ID only", () => {
    expect(isPremiumProduct(PADDLE_CONFIG.products.premium)).toBe(true);
    if (PADDLE_CONFIG.products.ultra) {
      expect(isPremiumProduct(PADDLE_CONFIG.products.ultra)).toBe(false);
    }
  });

  it("isUltraProduct returns true for ultra product ID only", () => {
    if (PADDLE_CONFIG.products.ultra) {
      expect(isUltraProduct(PADDLE_CONFIG.products.ultra)).toBe(true);
    }
    expect(isUltraProduct(PADDLE_CONFIG.products.premium)).toBe(false);
    // Empty string should not match
    expect(isUltraProduct("")).toBe(false);
  });

  it("isUltraPrice returns true for ultra price IDs only", () => {
    if (PADDLE_CONFIG.prices.ultraMonthly) {
      expect(isUltraPrice(PADDLE_CONFIG.prices.ultraMonthly)).toBe(true);
    }
    if (PADDLE_CONFIG.prices.ultraYearly) {
      expect(isUltraPrice(PADDLE_CONFIG.prices.ultraYearly)).toBe(true);
    }
    expect(isUltraPrice(PADDLE_CONFIG.prices.premiumMonthly)).toBe(false);
    expect(isUltraPrice("")).toBe(false);
  });

  it("getPlanFromProductId maps correctly", () => {
    expect(getPlanFromProductId(PADDLE_CONFIG.products.premium)).toBe("premium");
    if (PADDLE_CONFIG.products.ultra) {
      expect(getPlanFromProductId(PADDLE_CONFIG.products.ultra)).toBe("ultra");
    }
    expect(getPlanFromProductId("unknown-id")).toBe("free_user");
  });
});
