import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    userLimits: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../../services/quiz/utils/personalizationUtils.js", () => ({
  getUserPersonalization: vi.fn(),
  mapToSchoolLevelEnum: vi.fn((v: string) => v),
}));

vi.mock("../../../services/billing/paddleBilling.js", () => ({
  PaddleBillingService: {
    getUserSubscription: vi.fn(),
  },
}));

vi.mock("../../../services/quiz/preprocessor/QuizPreprocessorAgent.js", () => ({
  quizPreprocessorAgent: {
    analyzeAndRecommend: vi.fn(),
  },
}));

vi.mock("../sourceAnalyzer.js", () => ({
  analyzeSourceContent: vi.fn(),
}));

// Import mocked modules after vi.mock declarations
import { prisma } from "../../../lib/prisma.js";
import { getUserPersonalization } from "../../../services/quiz/utils/personalizationUtils.js";
import { PaddleBillingService } from "../../../services/billing/paddleBilling.js";
import { quizPreprocessorAgent } from "../../../services/quiz/preprocessor/QuizPreprocessorAgent.js";
import { analyzeSourceContent } from "../sourceAnalyzer.js";

import {
  resolvePersonalization,
  callPreprocessorIfNeeded,
  checkPremiumIntelligent,
} from "../parameterResolver.js";

// Typed mocks
const mockGetUserPersonalization = getUserPersonalization as ReturnType<typeof vi.fn>;
const mockGetUserSubscription = PaddleBillingService.getUserSubscription as ReturnType<
  typeof vi.fn
>;
const mockAnalyzeAndRecommend = quizPreprocessorAgent.analyzeAndRecommend as ReturnType<
  typeof vi.fn
>;
const mockAnalyzeSourceContent = analyzeSourceContent as ReturnType<typeof vi.fn>;
const mockFindUniqueLimits = prisma.userLimits.findUnique as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolvePersonalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Returns personalization schoolLevel when usePersonalization is true
  // -------------------------------------------------------------------------
  it("returns personalization classe when usePersonalization is true", async () => {
    mockGetUserPersonalization.mockResolvedValue({ classe: "Terminale" });

    const result = await resolvePersonalization("user-1", "COLLEGE", true);

    expect(mockGetUserPersonalization).toHaveBeenCalledWith("user-1");
    expect(result).toBe("Terminale");
  });

  // -------------------------------------------------------------------------
  // 2. Falls back to bodySchoolLevel when no personalization found
  // -------------------------------------------------------------------------
  it("falls back to bodySchoolLevel when no personalization found", async () => {
    mockGetUserPersonalization.mockResolvedValue(null);

    const result = await resolvePersonalization("user-1", "LYCEE_SECONDE", true);

    expect(result).toBe("LYCEE_SECONDE");
  });

  // -------------------------------------------------------------------------
  // 3. Defaults to COLLEGE when nothing available
  // -------------------------------------------------------------------------
  it("defaults to COLLEGE when nothing available", async () => {
    mockGetUserPersonalization.mockResolvedValue(null);

    const result = await resolvePersonalization("user-1", undefined, true);

    expect(result).toBe("COLLEGE");
  });

  // -------------------------------------------------------------------------
  // 4. Uses bodySchoolLevel directly when usePersonalization is false
  // -------------------------------------------------------------------------
  it("uses bodySchoolLevel directly when usePersonalization is false and bodySchoolLevel is set", async () => {
    const result = await resolvePersonalization("user-1", "ETUDES_SUPERIEURES", false);

    expect(mockGetUserPersonalization).not.toHaveBeenCalled();
    expect(result).toBe("ETUDES_SUPERIEURES");
  });

  // -------------------------------------------------------------------------
  // 5. Fetches personalization when bodySchoolLevel is undefined (even if usePersonalization false)
  // -------------------------------------------------------------------------
  it("fetches personalization when bodySchoolLevel is undefined", async () => {
    mockGetUserPersonalization.mockResolvedValue({ classe: "Master" });

    const result = await resolvePersonalization("user-1", undefined, false);

    expect(mockGetUserPersonalization).toHaveBeenCalledWith("user-1");
    expect(result).toBe("Master");
  });

  // -------------------------------------------------------------------------
  // 6. Falls back to bodySchoolLevel when personalization has no classe
  // -------------------------------------------------------------------------
  it("falls back to bodySchoolLevel when personalization has no classe", async () => {
    mockGetUserPersonalization.mockResolvedValue({ etude: "Informatique" });

    const result = await resolvePersonalization("user-1", "LYCEE_PREMIERE", true);

    expect(result).toBe("LYCEE_PREMIERE");
  });
});

// ---------------------------------------------------------------------------
// callPreprocessorIfNeeded
// ---------------------------------------------------------------------------
describe("callPreprocessorIfNeeded", () => {
  const mockSendSSE = vi.fn();

  const baseParams = {
    letAIChoose: true,
    pageProjectIds: ["page-1", "page-2"],
    userId: "user-1",
    schoolLevel: "COLLEGE",
    questionCount: 10,
    difficulty: "medium" as const,
    sendSSE: mockSendSSE,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Returns unchanged when letAIChoose is false
  // -------------------------------------------------------------------------
  it("returns unchanged when letAIChoose is false", async () => {
    const result = await callPreprocessorIfNeeded({
      ...baseParams,
      letAIChoose: false,
    });

    expect(result).toEqual({
      questionCount: 10,
      difficulty: "medium",
      typeDistribution: null,
    });
    expect(mockAnalyzeSourceContent).not.toHaveBeenCalled();
    expect(mockSendSSE).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Returns unchanged when no pages
  // -------------------------------------------------------------------------
  it("returns unchanged when no pages", async () => {
    const result = await callPreprocessorIfNeeded({
      ...baseParams,
      pageProjectIds: [],
    });

    expect(result).toEqual({
      questionCount: 10,
      difficulty: "medium",
      typeDistribution: null,
    });
    expect(mockAnalyzeSourceContent).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Calls preprocessor and returns recommendations when content is sufficient
  // -------------------------------------------------------------------------
  it("calls preprocessor and returns recommendations when content is sufficient", async () => {
    mockAnalyzeSourceContent.mockResolvedValue({
      textContent: "lots of content here",
      wordCount: 200,
      summary: "A summary of the content",
      topics: ["math", "physics"],
      hasFormulas: true,
      hasDefinitions: false,
    });

    mockFindUniqueLimits.mockResolvedValue({ questionsPerQuizLimit: 25 });

    mockAnalyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 15,
      questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"],
      difficulty: "hard",
      suggestedTimeLimit: 30,
      reasoning: "Based on analysis",
    });

    const result = await callPreprocessorIfNeeded(baseParams);

    expect(mockSendSSE).toHaveBeenCalledWith("status", { message: "ai-analyzing" });
    expect(mockAnalyzeSourceContent).toHaveBeenCalledWith("user-1", ["page-1", "page-2"]);
    expect(mockAnalyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolLevel: "COLLEGE",
        studyLevel: "College",
        quizType: "ENTRAINEMENT",
        wordCount: 200,
        subscriptionLimit: 25,
      }),
      "user-1",
    );
    expect(mockSendSSE).toHaveBeenCalledWith("status", { message: "ai-recommendations" });
    expect(result).toEqual({
      questionCount: 15,
      difficulty: "hard",
      typeDistribution: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"],
    });
  });

  // -------------------------------------------------------------------------
  // 4. Returns unchanged when word count < 50
  // -------------------------------------------------------------------------
  it("returns unchanged when word count < 50", async () => {
    mockAnalyzeSourceContent.mockResolvedValue({
      textContent: "short",
      wordCount: 30,
      summary: "short",
      topics: [],
      hasFormulas: false,
      hasDefinitions: false,
    });

    const result = await callPreprocessorIfNeeded(baseParams);

    expect(mockAnalyzeAndRecommend).not.toHaveBeenCalled();
    expect(result).toEqual({
      questionCount: 10,
      difficulty: "medium",
      typeDistribution: null,
    });
  });

  // -------------------------------------------------------------------------
  // 5. Returns unchanged on preprocessor error (sends ai-fallback SSE)
  // -------------------------------------------------------------------------
  it("returns unchanged on preprocessor error and sends ai-fallback SSE", async () => {
    mockAnalyzeSourceContent.mockResolvedValue({
      textContent: "enough content for analysis",
      wordCount: 100,
      summary: "summary",
      topics: ["topic"],
      hasFormulas: false,
      hasDefinitions: false,
    });

    mockFindUniqueLimits.mockResolvedValue({ questionsPerQuizLimit: 50 });
    mockAnalyzeAndRecommend.mockRejectedValue(new Error("OpenAI timeout"));

    const result = await callPreprocessorIfNeeded(baseParams);

    expect(mockSendSSE).toHaveBeenCalledWith("status", { message: "ai-fallback" });
    expect(result).toEqual({
      questionCount: 10,
      difficulty: "medium",
      typeDistribution: null,
    });
  });

  // -------------------------------------------------------------------------
  // 6. Uses default subscriptionLimit (50) when userLimits not found
  // -------------------------------------------------------------------------
  it("uses default subscriptionLimit when userLimits not found", async () => {
    mockAnalyzeSourceContent.mockResolvedValue({
      textContent: "content",
      wordCount: 100,
      summary: "summary",
      topics: [],
      hasFormulas: false,
      hasDefinitions: false,
    });

    mockFindUniqueLimits.mockResolvedValue(null);

    mockAnalyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 8,
      questionTypes: ["MULTIPLE_CHOICE"],
      difficulty: "easy",
      suggestedTimeLimit: 10,
      reasoning: "Default limit test",
    });

    await callPreprocessorIfNeeded(baseParams);

    expect(mockAnalyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionLimit: 50,
      }),
      "user-1",
    );
  });
});

// ---------------------------------------------------------------------------
// checkPremiumIntelligent
// ---------------------------------------------------------------------------
describe("checkPremiumIntelligent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Returns true for premium user with 2+ pages
  // -------------------------------------------------------------------------
  it("returns true for premium user with 2+ pages", async () => {
    mockGetUserSubscription.mockResolvedValue({ isPremium: true });

    const result = await checkPremiumIntelligent("user-1", false, 3);

    expect(mockGetUserSubscription).toHaveBeenCalledWith("user-1");
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Returns false for non-premium user
  // -------------------------------------------------------------------------
  it("returns false for non-premium user with 2+ pages", async () => {
    mockGetUserSubscription.mockResolvedValue({ isPremium: false });

    const result = await checkPremiumIntelligent("user-1", false, 2);

    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Returns requestUseIntelligent if pageCount < 2
  // -------------------------------------------------------------------------
  it("returns requestUseIntelligent unchanged if pageCount < 2", async () => {
    const result = await checkPremiumIntelligent("user-1", false, 1);

    expect(mockGetUserSubscription).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("returns true when requestUseIntelligent is true regardless of pageCount", async () => {
    const result = await checkPremiumIntelligent("user-1", true, 0);

    expect(mockGetUserSubscription).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Returns requestUseIntelligent on error
  // -------------------------------------------------------------------------
  it("returns requestUseIntelligent on error", async () => {
    mockGetUserSubscription.mockRejectedValue(new Error("DB connection failed"));

    const result = await checkPremiumIntelligent("user-1", false, 5);

    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 5. Does not check subscription when requestUseIntelligent is already true
  // -------------------------------------------------------------------------
  it("does not check subscription when requestUseIntelligent is already true", async () => {
    const result = await checkPremiumIntelligent("user-1", true, 5);

    expect(mockGetUserSubscription).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
