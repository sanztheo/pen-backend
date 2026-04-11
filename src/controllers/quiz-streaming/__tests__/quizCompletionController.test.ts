import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
const mockTransaction = vi.fn();
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    quiz: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

const mockFinalizeCorrections = vi.fn();
const mockCorrectSingle = vi.fn();
vi.mock("../../../services/quiz/generators/correctionGenerator.js", () => ({
  CorrectionGenerator: {
    finalizeCorrections: (...args: unknown[]) => mockFinalizeCorrections(...args),
    correctSingle: (...args: unknown[]) => mockCorrectSingle(...args),
  },
}));

vi.mock("../../../services/quiz/intelligence/index.js", () => ({
  CorrectionEnricherService: {
    enrichCorrections: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../lib/redis.js", () => ({
  redis: null,
  invalidateQuizHistoryCache: vi.fn().mockResolvedValue(undefined),
}));

import { completeQuiz } from "../quizCompletionController.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user-123" },
    params: { id: "quiz-abc" },
    body: {
      answers: [
        { questionId: "q1", answer: "option-a", timeSpent: 10 },
        { questionId: "q2", answer: "Gravity pulls objects", timeSpent: 45 },
      ],
    },
    ...overrides,
  };
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const sampleQuiz = {
  id: "quiz-abc",
  questions: [
    {
      id: "q1",
      type: "MULTIPLE_CHOICE",
      question: "What is 2+2?",
      points: 1,
      options: [
        { id: "option-a", text: "4", isCorrect: true },
        { id: "option-b", text: "5", isCorrect: false },
      ],
    },
    {
      id: "q2",
      type: "OPEN_QUESTION",
      question: "Explain gravity",
      points: 2,
      expectedAnswer: "Force that attracts bodies",
    },
  ],
  schoolLevel: "COLLEGE",
  hasDocuments: false,
  isCompleted: false,
};

const sampleFinalizeResult = {
  sortedCorrections: [
    { questionId: "q1", score: 1, maxScore: 1, isCorrect: true },
    { questionId: "q2", score: 1.5, maxScore: 2, isCorrect: false },
  ],
  scores: { totalScore: 2.5, maxScore: 3, percentage: 83.33, adaptedGrade: 16.67 },
  analysis: {
    summary: "Good job",
    strengths: ["MCQ mastery"],
    weaknesses: ["Open questions need detail"],
    recommendations: ["Study more"],
    personalizedTips: ["Focus on explanations"],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("completeQuiz", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: correctSingle returns a simple correction for each question
    mockCorrectSingle.mockImplementation(async (question: { id: string; points?: number }) => ({
      questionId: question.id,
      score: 1,
      maxScore: question.points || 1,
      isCorrect: true,
      userAnswer: "test",
      correctAnswer: "test",
      explanation: "Correct",
    }));

    mockFinalizeCorrections.mockResolvedValue(sampleFinalizeResult);

    // Mock transaction to execute the callback
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        quiz: { update: vi.fn().mockResolvedValue({}) },
        quizResult: { create: vi.fn().mockResolvedValue({ id: "result-1" }) },
      };
      return fn(tx);
    });
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 if user is not authenticated", async () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── Validation Zod ────────────────────────────────────────────────────────

  it("returns 400 if answers is not an array", async () => {
    const req = mockReq({ body: { answers: "not-array" } });
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 if answers is empty", async () => {
    const req = mockReq({ body: { answers: [] } });
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 if answer item has no questionId", async () => {
    const req = mockReq({ body: { answers: [{ answer: "test" }] } });
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  // ── Quiz ownership + completion ───────────────────────────────────────────

  it("returns 404 if quiz not found or already completed", async () => {
    mockFindFirst.mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "quiz-abc",
          userId: "user-123",
          isCompleted: false,
        }),
      }),
    );
  });

  // ── Server-side re-correction (CRITICAL security fix) ─────────────────────

  it("re-corrects all answers server-side via CorrectionGenerator.correctSingle", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    // correctSingle called once per question
    expect(mockCorrectSingle).toHaveBeenCalledTimes(2);
    expect(mockCorrectSingle).toHaveBeenCalledWith(
      sampleQuiz.questions[0],
      expect.objectContaining({ questionId: "q1" }),
      expect.any(Object),
    );
    expect(mockCorrectSingle).toHaveBeenCalledWith(
      sampleQuiz.questions[1],
      expect.objectContaining({ questionId: "q2" }),
      expect.any(Object),
    );
  });

  it("passes server-computed corrections (not client ones) to finalizeCorrections", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockResolvedValue({
      questionId: "q1",
      score: 0,
      maxScore: 1,
      isCorrect: false,
    });

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    // finalizeCorrections receives server-computed corrections
    expect(mockFinalizeCorrections).toHaveBeenCalledWith(
      sampleQuiz.questions,
      expect.arrayContaining([expect.objectContaining({ questionId: "q1", score: 0 })]),
      expect.any(Object),
    );
  });

  it("ignores any corrections[] field sent by client", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    // Client tries to send fabricated corrections
    const req = mockReq({
      body: {
        answers: [{ questionId: "q1", answer: "wrong" }],
        corrections: [{ questionId: "q1", score: 999, maxScore: 1, isCorrect: true }],
      },
    });
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    // Server-side correction used, not client corrections
    expect(mockCorrectSingle).toHaveBeenCalled();
    expect(mockFinalizeCorrections).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ score: 999 })]),
      expect.anything(),
    );
  });

  // ── DB select ─────────────────────────────────────────────────────────────

  it("fetches quiz with select projection", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          questions: true,
          schoolLevel: true,
        }),
      }),
    );
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns quizId, result, and analysis on success", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        quizId: "quiz-abc",
        result: expect.objectContaining({
          totalScore: 2.5,
          maxScore: 3,
          percentage: 83.33,
        }),
        analysis: expect.objectContaining({
          summary: "Good job",
          strengths: expect.any(Array),
        }),
      }),
    );
  });

  it("persists results in a transaction (quiz update + quizResult create)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 500 if server-side re-correction fails", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockRejectedValue(new Error("AI exploded"));

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("continues if enrichment fails (non-blocking)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    // Mock enrichment to fail
    const { CorrectionEnricherService } =
      await import("../../../services/quiz/intelligence/index.js");
    vi.mocked(CorrectionEnricherService.enrichCorrections).mockRejectedValueOnce(
      new Error("RAG down"),
    );

    const req = mockReq();
    const res = mockRes();

    await completeQuiz(req as never, res as never);

    // Should still succeed
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ quizId: "quiz-abc" }));
  });
});
