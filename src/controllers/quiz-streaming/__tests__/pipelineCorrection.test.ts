import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the pipeline correction public methods on CorrectionGenerator:
 * - correctSingle (routes to closed or open correction)
 * - finalizeCorrections (scores, AI analysis, Gemini suggestions)
 *
 * These are integration-style unit tests that mock the AI service layer
 * but exercise the real correction logic for closed questions.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

// Mock AIService to avoid real LLM calls
vi.mock("../../../services/ai/aiService.js", () => ({
  AIService: {
    generateContent: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        score: 1.5,
        explanation: "Decent answer",
        suggestion: "Add more detail",
      }),
    }),
    getQuizCorrectionModel: vi.fn().mockReturnValue("test-model"),
    getQuizExplanationModel: vi.fn().mockReturnValue("test-gemini"),
    getOpenAICompatibleClient: vi.fn().mockReturnValue({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "[]" } }],
          }),
        },
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMCQ(id: string, correctOptionId: string) {
  return {
    id,
    type: "MULTIPLE_CHOICE" as const,
    question: `Question ${id}`,
    points: 1,
    options: [
      { id: "opt-a", text: "Option A", isCorrect: correctOptionId === "opt-a" },
      { id: "opt-b", text: "Option B", isCorrect: correctOptionId === "opt-b" },
    ],
  };
}

function makeTrueFalse(id: string, correctAnswer: boolean) {
  return {
    id,
    type: "TRUE_FALSE" as const,
    question: `True or false: ${id}`,
    points: 1,
    correctAnswer,
  };
}

function makeOpenQuestion(id: string) {
  return {
    id,
    type: "OPEN_QUESTION" as const,
    question: `Explain: ${id}`,
    points: 2,
    expectedAnswer: "Expected detailed answer",
  };
}

function makeRequest(quizId = "quiz-1") {
  return {
    quizId,
    userId: "user-1",
    userAnswers: [],
    submittedAt: new Date(),
    preset: "NONE",
    schoolLevel: "COLLEGE",
    hasDocuments: false,
    sourceDocuments: [],
    coursesOnly: false,
    workspaceContent: [],
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

// Dynamic import to ensure mocks are registered first
const { CorrectionGenerator } =
  await import("../../../services/quiz/generators/correctionGenerator.js");

// ---------------------------------------------------------------------------
// correctSingle
// ---------------------------------------------------------------------------

describe("CorrectionGenerator.correctSingle", () => {
  const request = makeRequest();

  describe("MCQ (MULTIPLE_CHOICE)", () => {
    const question = makeMCQ("q1", "opt-a");

    it("returns isCorrect=true when user selects the correct option", async () => {
      const userAnswer = { questionId: "q1", answer: "opt-a", timeSpent: 5 };

      const result = await CorrectionGenerator.correctSingle(
        question as never,
        userAnswer as never,
        request as never,
      );

      expect(result.questionId).toBe("q1");
      expect(result.isCorrect).toBe(true);
      expect(result.score).toBe(1);
      expect(result.maxScore).toBe(1);
    });

    it("returns isCorrect=false when user selects wrong option", async () => {
      const userAnswer = { questionId: "q1", answer: "opt-b", timeSpent: 5 };

      const result = await CorrectionGenerator.correctSingle(
        question as never,
        userAnswer as never,
        request as never,
      );

      expect(result.isCorrect).toBe(false);
      expect(result.score).toBe(0);
    });

    it("returns score=0 when no answer provided", async () => {
      const result = await CorrectionGenerator.correctSingle(
        question as never,
        undefined as never,
        request as never,
      );

      expect(result.isCorrect).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe("TRUE_FALSE", () => {
    const question = makeTrueFalse("q2", true);

    it("returns isCorrect=true when answer matches", async () => {
      const userAnswer = { questionId: "q2", answer: "Vrai", timeSpent: 3 };

      const result = await CorrectionGenerator.correctSingle(
        question as never,
        userAnswer as never,
        request as never,
      );

      expect(result.isCorrect).toBe(true);
      expect(result.score).toBe(1);
    });

    it("returns isCorrect=false when answer is wrong", async () => {
      const userAnswer = { questionId: "q2", answer: "Faux", timeSpent: 3 };

      const result = await CorrectionGenerator.correctSingle(
        question as never,
        userAnswer as never,
        request as never,
      );

      expect(result.isCorrect).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  describe("OPEN_QUESTION", () => {
    const question = makeOpenQuestion("q3");

    it("delegates to AI for open questions", async () => {
      // Spy on the private method to avoid real LLM call
      vi.spyOn(CorrectionGenerator as never, "correctSingleOpenQuestion").mockResolvedValue({
        questionId: "q3",
        userAnswer: "Gravity is a force",
        correctAnswer: "Expected detailed answer",
        score: 1.5,
        maxScore: 2,
        isCorrect: false,
        explanation: "Partial answer",
      });

      const userAnswer = { questionId: "q3", answer: "Gravity is a force", timeSpent: 30 };

      const result = await CorrectionGenerator.correctSingle(
        question as never,
        userAnswer as never,
        request as never,
      );

      expect(result.questionId).toBe("q3");
      expect(result.maxScore).toBe(2);
      expect(result.score).toBe(1.5);
    });
  });
});

// ---------------------------------------------------------------------------
// finalizeCorrections
// ---------------------------------------------------------------------------

describe("CorrectionGenerator.finalizeCorrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Spy on private methods to avoid real LLM/Gemini calls
    vi.spyOn(CorrectionGenerator as never, "generateDetailedAnalysis").mockResolvedValue({
      summary: "Test analysis",
      strengths: ["Good MCQ"],
      weaknesses: ["Weak open"],
      recommendations: ["Study more"],
      personalizedTips: ["Focus"],
    });
    vi.spyOn(
      CorrectionGenerator as never,
      "generateSuggestionsForClosedQuestions",
    ).mockImplementation(async (corrections: unknown[]) => corrections);
  });

  const questions = [makeMCQ("q1", "opt-a"), makeTrueFalse("q2", true), makeOpenQuestion("q3")];

  const corrections = [
    {
      questionId: "q1",
      userAnswer: "opt-a",
      correctAnswer: "opt-a",
      score: 1,
      maxScore: 1,
      isCorrect: true,
      explanation: "Correct",
    },
    {
      questionId: "q2",
      userAnswer: "Vrai",
      correctAnswer: "Vrai",
      score: 1,
      maxScore: 1,
      isCorrect: true,
      explanation: "Correct",
    },
    {
      questionId: "q3",
      userAnswer: "Gravity pulls things",
      correctAnswer: "Force that attracts",
      score: 1.5,
      maxScore: 2,
      isCorrect: false,
      explanation: "Partial",
    },
  ];

  it("returns correct score totals", async () => {
    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      corrections as never,
      makeRequest() as never,
    );

    expect(result.scores.totalScore).toBe(3.5);
    expect(result.scores.maxScore).toBe(4);
    expect(result.scores.percentage).toBeCloseTo(87.5, 0);
    expect(result.scores.adaptedGrade).toBeCloseTo(17.5, 0);
  });

  it("sorts corrections by original question order", async () => {
    // Pass corrections in reverse order
    const reversed = [...corrections].reverse();

    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      reversed as never,
      makeRequest() as never,
    );

    expect(result.sortedCorrections[0].questionId).toBe("q1");
    expect(result.sortedCorrections[1].questionId).toBe("q2");
    expect(result.sortedCorrections[2].questionId).toBe("q3");
  });

  it("returns empty results for empty corrections", async () => {
    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      [] as never,
      makeRequest() as never,
    );

    expect(result.sortedCorrections).toEqual([]);
    expect(result.scores.totalScore).toBe(0);
    expect(result.scores.maxScore).toBe(0);
    expect(result.analysis.summary).toBeTruthy();
  });

  it("returns analysis with expected shape", async () => {
    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      corrections as never,
      makeRequest() as never,
    );

    expect(result.analysis).toHaveProperty("summary");
    expect(result.analysis).toHaveProperty("strengths");
    expect(result.analysis).toHaveProperty("weaknesses");
    expect(result.analysis).toHaveProperty("recommendations");
    expect(result.analysis).toHaveProperty("personalizedTips");
    expect(Array.isArray(result.analysis.strengths)).toBe(true);
  });

  it("handles all-wrong corrections", async () => {
    const allWrong = corrections.map((c) => ({
      ...c,
      score: 0,
      isCorrect: false,
    }));

    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      allWrong as never,
      makeRequest() as never,
    );

    expect(result.scores.totalScore).toBe(0);
    expect(result.scores.percentage).toBe(0);
    expect(result.scores.adaptedGrade).toBe(0);
  });

  it("handles all-correct corrections", async () => {
    const allCorrect = corrections.map((c) => ({
      ...c,
      score: c.maxScore,
      isCorrect: true,
    }));

    const result = await CorrectionGenerator.finalizeCorrections(
      questions as never,
      allCorrect as never,
      makeRequest() as never,
    );

    expect(result.scores.totalScore).toBe(4);
    expect(result.scores.maxScore).toBe(4);
    expect(result.scores.percentage).toBe(100);
    expect(result.scores.adaptedGrade).toBe(20);
  });
});
