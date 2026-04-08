import { describe, it, expect } from "vitest";
import {
  AGENT_SELECTABLE_MODELS,
  CREDIT_TIERS,
  findSelectableModel,
  getModelsForPlan,
  getCreditMultiplier,
} from "../../config/models/selectable.js";

describe("Selectable Models — 3-tier pricing", () => {
  it("every model has creditMultiplier and requiredPlan", () => {
    for (const model of AGENT_SELECTABLE_MODELS) {
      expect(model.creditMultiplier).toBeGreaterThanOrEqual(1);
      expect(["free_user", "premium", "ultra"]).toContain(model.requiredPlan);
    }
  });

  it("CREDIT_TIERS maps tier names to multipliers", () => {
    expect(CREDIT_TIERS.eco).toBe(1);
    expect(CREDIT_TIERS.standard).toBe(2);
    expect(CREDIT_TIERS.premium).toBe(3);
    expect(CREDIT_TIERS.elite).toBe(5);
  });

  it("free_user models are all eco (1 credit)", () => {
    const freeModels = AGENT_SELECTABLE_MODELS.filter((m) => m.requiredPlan === "free_user");
    for (const model of freeModels) {
      expect(model.creditMultiplier).toBe(1);
    }
  });

  it("premium (Pro) models are eco only (1 credit)", () => {
    const proModels = AGENT_SELECTABLE_MODELS.filter((m) => m.requiredPlan === "premium");
    for (const model of proModels) {
      expect(model.creditMultiplier).toBe(1);
    }
  });

  it("ultra models span all tiers (1-5 credits)", () => {
    const ultraModels = AGENT_SELECTABLE_MODELS.filter((m) => m.requiredPlan === "ultra");
    const multipliers = new Set(ultraModels.map((m) => m.creditMultiplier));
    expect(multipliers.has(2)).toBe(true); // standard tier
    expect(multipliers.has(3)).toBe(true); // premium tier
    expect(multipliers.has(5)).toBe(true); // elite tier
  });

  it("claude-opus-4-6 costs 5 credits (elite)", () => {
    const opus = findSelectableModel("claude-opus-4-6:none");
    expect(opus).toBeDefined();
    expect(opus!.creditMultiplier).toBe(5);
    expect(opus!.requiredPlan).toBe("ultra");
  });

  it("getModelsForPlan filters correctly", () => {
    const freeModels = getModelsForPlan("free_user");
    const proModels = getModelsForPlan("premium");
    const ultraModels = getModelsForPlan("ultra");

    expect(freeModels.length).toBeGreaterThan(0);
    expect(proModels.length).toBeGreaterThan(freeModels.length);
    expect(ultraModels.length).toBeGreaterThan(proModels.length);
    expect(ultraModels.length).toBe(AGENT_SELECTABLE_MODELS.length);
  });

  it("getCreditMultiplier returns correct values", () => {
    expect(getCreditMultiplier("gemini-3-flash-preview:minimal")).toBe(1);
    expect(getCreditMultiplier("gpt-5:low")).toBe(2);
    expect(getCreditMultiplier("claude-sonnet-4-6:none")).toBe(3);
    expect(getCreditMultiplier("claude-opus-4-6:none")).toBe(5);
    expect(getCreditMultiplier("nonexistent:none")).toBe(1); // fallback
  });
});
