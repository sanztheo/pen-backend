import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockFindFirst = vi.fn();
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    quiz: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
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

const mockCorrectSingle = vi.fn();
vi.mock("../../../services/quiz/generators/correctionGenerator.js", () => ({
  CorrectionGenerator: {
    correctSingle: (...args: unknown[]) => mockCorrectSingle(...args),
  },
}));

const mockSismember = vi.fn();
const mockSadd = vi.fn();
const mockExpire = vi.fn();
vi.mock("../../../lib/redis.js", () => ({
  redis: {
    sismember: (...args: unknown[]) => mockSismember(...args),
    sadd: (...args: unknown[]) => mockSadd(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
  },
}));

import { correctSingleQuestion } from "../singleCorrectionController.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user-123" },
    params: { id: "quiz-abc" },
    body: {
      questionId: "q1",
      answer: "option-a",
      timeSpent: 30,
    },
    ...overrides,
  };
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
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
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("correctSingleQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSismember.mockResolvedValue(0);
    mockSadd.mockResolvedValue(1);
    mockExpire.mockResolvedValue(1);
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 if user is not authenticated", async () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  // ── Validation Zod ────────────────────────────────────────────────────────

  it("returns 400 if questionId is missing", async () => {
    const req = mockReq({ body: { answer: "test" } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 if answer is missing", async () => {
    const req = mockReq({ body: { questionId: "q1" } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 if answer exceeds max length", async () => {
    const req = mockReq({ body: { questionId: "q1", answer: "x".repeat(10001) } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts boolean answer (true/false questions)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockResolvedValue({
      questionId: "q1",
      score: 1,
      maxScore: 1,
      isCorrect: true,
    });

    const req = mockReq({ body: { questionId: "q1", answer: true } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ correction: expect.any(Object) }),
    );
  });

  it("accepts string array answer (matching questions)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockResolvedValue({
      questionId: "q1",
      score: 1,
      maxScore: 1,
      isCorrect: true,
    });

    const req = mockReq({ body: { questionId: "q1", answer: ["a", "b"] } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ correction: expect.any(Object) }),
    );
  });

  // ── Quiz ownership ────────────────────────────────────────────────────────

  it("returns 404 if quiz not found or not owned by user", async () => {
    mockFindFirst.mockResolvedValue(null);

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "quiz-abc", userId: "user-123" }),
      }),
    );
  });

  // ── Question not found ────────────────────────────────────────────────────

  it("returns 404 if questionId does not exist in quiz", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);

    const req = mockReq({ body: { questionId: "nonexistent", answer: "test" } });
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  // ── Duplicate correction ──────────────────────────────────────────────────

  it("returns 409 if question was already corrected (Redis dedup)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockSismember.mockResolvedValue(1); // already corrected

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockCorrectSingle).not.toHaveBeenCalled();
  });

  it("proceeds if Redis dedup check fails (non-blocking)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockSismember.mockRejectedValue(new Error("Redis down"));
    mockCorrectSingle.mockResolvedValue({
      questionId: "q1",
      score: 1,
      maxScore: 1,
      isCorrect: true,
    });

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    // Should still correct despite Redis failure
    expect(mockCorrectSingle).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ correction: expect.any(Object) }),
    );
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("corrects a question and returns the correction", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    const correction = {
      questionId: "q1",
      userAnswer: "option-a",
      correctAnswer: "option-a",
      score: 1,
      maxScore: 1,
      isCorrect: true,
      explanation: "Correct!",
    };
    mockCorrectSingle.mockResolvedValue(correction);

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(mockCorrectSingle).toHaveBeenCalledWith(
      sampleQuiz.questions[0], // question
      expect.objectContaining({ questionId: "q1", answer: "option-a" }), // userAnswer
      expect.objectContaining({ quizId: "quiz-abc", userId: "user-123" }), // request
    );
    expect(res.json).toHaveBeenCalledWith({ correction });
  });

  it("marks question as corrected in Redis after success", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockResolvedValue({ questionId: "q1", score: 1 });

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(mockSadd).toHaveBeenCalledWith("quiz:quiz-abc:corrected", "q1");
    expect(mockExpire).toHaveBeenCalledWith("quiz:quiz-abc:corrected", 3600);
  });

  // ── DB select projection ──────────────────────────────────────────────────

  it("fetches quiz with select projection (not full row)", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockResolvedValue({ questionId: "q1", score: 1 });

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

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

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 500 if CorrectionGenerator throws", async () => {
    mockFindFirst.mockResolvedValue(sampleQuiz);
    mockCorrectSingle.mockRejectedValue(new Error("AI service down"));

    const req = mockReq();
    const res = mockRes();

    await correctSingleQuestion(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
