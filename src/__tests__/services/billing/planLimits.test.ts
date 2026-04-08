import { describe, it, expect } from "vitest";
import { PLAN_LIMITS } from "../../../config/planLimits.js";

describe("Plan limits — 3 tiers", () => {
  it("free_user limits match spec", () => {
    expect(PLAN_LIMITS.free_user).toEqual({
      aiCreditsLimit: 50,
      workspacesLimit: 2,
      customQuizzesLimit: 5,
      presetSequencesLimit: 1,
      pagesSelectionLimit: 2,
      questionsPerQuizLimit: 10,
      advancedQuizzesLimit: 10,
    });
  });

  it("premium (Pro) limits match spec", () => {
    expect(PLAN_LIMITS.premium).toEqual({
      aiCreditsLimit: 500,
      workspacesLimit: -1,
      customQuizzesLimit: 20,
      presetSequencesLimit: -1,
      pagesSelectionLimit: 10,
      questionsPerQuizLimit: 20,
      advancedQuizzesLimit: -1,
    });
  });

  it("ultra limits match spec", () => {
    expect(PLAN_LIMITS.ultra).toEqual({
      aiCreditsLimit: 2000,
      workspacesLimit: -1,
      customQuizzesLimit: -1,
      presetSequencesLimit: -1,
      pagesSelectionLimit: 30,
      questionsPerQuizLimit: 40,
      advancedQuizzesLimit: -1,
    });
  });
});
