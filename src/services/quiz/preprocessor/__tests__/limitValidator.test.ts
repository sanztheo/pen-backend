/**
 * 🧪 Limit Validator Tests - PEN-37
 * Tests unitaires pour la validation et correction des limites de quiz
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { QuizLimitValidator } from "../limitValidator.js";
import { SUBSCRIPTION_LIMITS, DEFAULT_QUESTION_TYPES } from "../constants.js";
import type { QuizPreprocessorOutput, QuestionType } from "../types.js";
import { prisma } from "../../../../lib/prisma.js";

// Create mock functions
const mockUserSubscriptionFindUnique = jest.fn();
const mockUserLimitsFindUnique = jest.fn();
const mockUserLimitsCreate = jest.fn();

// Replace prisma methods with mocks
(prisma.userSubscription as any).findUnique = mockUserSubscriptionFindUnique;
(prisma.userLimits as any).findUnique = mockUserLimitsFindUnique;
(prisma.userLimits as any).create = mockUserLimitsCreate;

describe("SUBSCRIPTION_LIMITS constants", () => {
  it("should have correct limits for free_user plan", () => {
    const freeLimits = SUBSCRIPTION_LIMITS.free_user;

    expect(freeLimits.maxQuestionsPerQuiz).toBe(10);
    expect(freeLimits.allowedQuestionTypes).toEqual([
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
    ]);
    expect(freeLimits.maxPagesSelection).toBe(2);
    expect(freeLimits.maxQuizzesPerMonth).toBe(5);
    expect(freeLimits.advancedQuizzes).toBe(false);
  });

  it("should have correct limits for premium plan", () => {
    const premiumLimits = SUBSCRIPTION_LIMITS.premium;

    expect(premiumLimits.maxQuestionsPerQuiz).toBe(40);
    expect(premiumLimits.allowedQuestionTypes).toEqual([
      "OPEN_QUESTION",
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
      "MATCHING",
    ]);
    expect(premiumLimits.maxPagesSelection).toBe(30);
    expect(premiumLimits.maxQuizzesPerMonth).toBe(-1); // Illimité
    expect(premiumLimits.advancedQuizzes).toBe(true);
  });
});

describe("DEFAULT_QUESTION_TYPES constants", () => {
  it("should have correct default types for free_user", () => {
    expect(DEFAULT_QUESTION_TYPES.free_user).toEqual([
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
    ]);
  });

  it("should have correct default types for premium", () => {
    expect(DEFAULT_QUESTION_TYPES.premium).toEqual([
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
      "OPEN_QUESTION",
      "MATCHING",
    ]);
  });
});

describe("QuizLimitValidator - validateAndCorrect", () => {
  let validator: QuizLimitValidator;

  beforeEach(() => {
    validator = new QuizLimitValidator();
    jest.clearAllMocks();
  });

  it("should pass validation for free user within limits", async () => {
    // Mock free user
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 8,
      questionTypes: [
        "MULTIPLE_CHOICE",
        "MULTIPLE_CHOICE",
        "MULTIPLE_CHOICE",
        "TRUE_FALSE",
        "TRUE_FALSE",
        "TRUE_FALSE",
        "MULTIPLE_CHOICE",
        "TRUE_FALSE",
      ],
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Test quiz",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.isValid).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.upgradeRequired).toBe(false);
    expect(result.correctedOutput.recommendedQuestionCount).toBe(8);
  });

  it("should correct question count exceeding free user limit", async () => {
    // Mock free user
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 25,
      questionTypes: Array(25).fill("MULTIPLE_CHOICE") as QuestionType[],
      difficulty: "medium",
      suggestedTimeLimit: 30,
      reasoning: "Test quiz",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.isValid).toBe(false);
    expect(result.upgradeRequired).toBe(true);
    expect(result.correctedOutput.recommendedQuestionCount).toBe(10);
    expect(result.corrections.length).toBe(1);
    expect(result.corrections[0].field).toBe("questionCount");
    expect(result.corrections[0].originalValue).toBe(25);
    expect(result.corrections[0].correctedValue).toBe(10);
    expect(result.correctedOutput.correctedByLimits).toBe(true);
  });

  it("should pass validation for premium user with high count", async () => {
    // Mock premium user
    mockUserSubscriptionFindUnique.mockResolvedValue({
      userId: "user-premium",
      plan: "premium",
      status: "active",
    });
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-premium",
      questionsPerQuizLimit: 40,
      pagesSelectionLimit: 30,
      customQuizzesLimit: -1,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 35,
      questionTypes: Array(35).fill("MULTIPLE_CHOICE") as QuestionType[],
      difficulty: "hard",
      suggestedTimeLimit: 60,
      reasoning: "Advanced quiz",
    };

    const result = await validator.validateAndCorrect(
      aiSuggestion,
      "user-premium",
    );

    expect(result.isValid).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.upgradeRequired).toBe(false);
  });

  it("should correct invalid question types for free user", async () => {
    // Mock free user
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 8,
      questionTypes: [
        "MULTIPLE_CHOICE",
        "OPEN_QUESTION", // ❌ Not allowed for free
        "TRUE_FALSE",
        "MATCHING", // ❌ Not allowed for free
        "MULTIPLE_CHOICE",
        "OPEN_QUESTION", // ❌ Not allowed for free
        "TRUE_FALSE",
        "MULTIPLE_CHOICE",
      ],
      difficulty: "medium",
      suggestedTimeLimit: 20,
      reasoning: "Test quiz",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.isValid).toBe(false);
    expect(result.upgradeRequired).toBe(true);
    expect(result.corrections.length).toBe(1);
    expect(result.corrections[0].field).toBe("questionTypes");
    expect(result.correctedOutput.correctedByLimits).toBe(true);

    // Vérifier que les types invalides sont filtrés
    const correctedTypes = result.correctedOutput.questionTypes;
    expect(
      correctedTypes.every((t) =>
        ["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(t),
      ),
    ).toBe(true);
  });

  it("should use default types if all types are invalid", async () => {
    // Mock free user
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 6,
      questionTypes: [
        "OPEN_QUESTION",
        "OPEN_QUESTION",
        "MATCHING",
        "MATCHING",
        "OPEN_QUESTION",
        "MATCHING",
      ] as QuestionType[],
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Test quiz",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.isValid).toBe(false);
    expect(result.upgradeRequired).toBe(true);
    expect(result.correctedOutput.questionTypes).toEqual(
      DEFAULT_QUESTION_TYPES.free_user,
    );
  });

  it("should create userLimits if not exists", async () => {
    // Mock user without limits
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue(null);
    mockUserLimitsCreate.mockResolvedValue({
      userId: "user-new",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 5,
      questionTypes: Array(5).fill("MULTIPLE_CHOICE") as QuestionType[],
      difficulty: "easy",
      suggestedTimeLimit: 10,
      reasoning: "Test",
    };

    await validator.validateAndCorrect(aiSuggestion, "user-new");

    expect(prisma.userLimits.create).toHaveBeenCalledWith({
      data: {
        userId: "user-new",
        questionsPerQuizLimit: 10,
        pagesSelectionLimit: 2,
        customQuizzesLimit: 5,
        customQuizzesUsed: 0,
      },
    });
  });

  it("should preserve originalRecommendations when correcting", async () => {
    // Mock free user
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 20,
      questionTypes: Array(20).fill("OPEN_QUESTION") as QuestionType[],
      difficulty: "hard",
      suggestedTimeLimit: 40,
      reasoning: "Advanced content",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.correctedOutput.originalRecommendations).toBeDefined();
    expect(result.correctedOutput.originalRecommendations?.questionCount).toBe(
      20,
    );
    expect(
      result.correctedOutput.originalRecommendations?.questionTypes.length,
    ).toBe(20);
  });
});

describe("QuizLimitValidator - canCreateQuiz", () => {
  let validator: QuizLimitValidator;

  beforeEach(() => {
    validator = new QuizLimitValidator();
    jest.clearAllMocks();
  });

  it("should allow free user within limits", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 2,
    });

    const result = await validator.canCreateQuiz("user-1", 8, [
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
    ]);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("should reject free user exceeding question count", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 2,
    });

    const result = await validator.canCreateQuiz("user-1", 15, [
      "MULTIPLE_CHOICE",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("limité à 10 questions");
  });

  it("should reject free user using premium question types", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 2,
    });

    const result = await validator.canCreateQuiz("user-1", 5, [
      "OPEN_QUESTION",
      "MATCHING",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Premium");
  });

  it("should reject free user who reached monthly quota", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 5, // Quota atteint
    });

    const result = await validator.canCreateQuiz("user-1", 5, [
      "MULTIPLE_CHOICE",
    ]);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Quota mensuel");
  });

  it("should allow premium user with unlimited quota", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue({
      userId: "user-premium",
      plan: "premium",
      status: "active",
    });
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-premium",
      questionsPerQuizLimit: 40,
      pagesSelectionLimit: 30,
      customQuizzesLimit: -1, // Illimité
      customQuizzesUsed: 100,
    });

    const result = await validator.canCreateQuiz("user-premium", 30, [
      "OPEN_QUESTION",
      "MATCHING",
    ]);

    expect(result.allowed).toBe(true);
  });
});

describe("QuizLimitValidator - getLimitsForPlan", () => {
  let validator: QuizLimitValidator;

  beforeEach(() => {
    validator = new QuizLimitValidator();
  });

  it("should return correct limits for free_user", () => {
    const limits = validator.getLimitsForPlan("free_user");

    expect(limits.maxQuestionsPerQuiz).toBe(10);
    expect(limits.allowedQuestionTypes).toContain("MULTIPLE_CHOICE");
    expect(limits.advancedQuizzes).toBe(false);
  });

  it("should return correct limits for premium", () => {
    const limits = validator.getLimitsForPlan("premium");

    expect(limits.maxQuestionsPerQuiz).toBe(40);
    expect(limits.allowedQuestionTypes).toContain("OPEN_QUESTION");
    expect(limits.advancedQuizzes).toBe(true);
  });
});

describe("QuizLimitValidator - Edge Cases", () => {
  let validator: QuizLimitValidator;

  beforeEach(() => {
    validator = new QuizLimitValidator();
    jest.clearAllMocks();
  });

  it("should handle empty question types array", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 5,
      questionTypes: [],
      difficulty: "medium",
      suggestedTimeLimit: 10,
      reasoning: "Test",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.correctedOutput.questionTypes).toEqual(
      DEFAULT_QUESTION_TYPES.free_user,
    );
  });

  it("should handle zero question count", async () => {
    mockUserSubscriptionFindUnique.mockResolvedValue(null);
    mockUserLimitsFindUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
      pagesSelectionLimit: 2,
      customQuizzesLimit: 5,
      customQuizzesUsed: 0,
    });

    const aiSuggestion: QuizPreprocessorOutput = {
      recommendedQuestionCount: 0,
      questionTypes: [],
      difficulty: "easy",
      suggestedTimeLimit: 5,
      reasoning: "Minimal quiz",
    };

    const result = await validator.validateAndCorrect(aiSuggestion, "user-1");

    expect(result.isValid).toBe(true);
    expect(result.correctedOutput.recommendedQuestionCount).toBe(0);
  });
});
