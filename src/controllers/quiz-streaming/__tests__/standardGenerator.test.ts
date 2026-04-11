import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Question } from "../../../services/quiz/types.js";
import { QuestionType } from "../../../services/quiz/types.js";
import { LyceeSpecialty } from "../../../services/quiz/types.js";
import { generateQuestionsStandard, type StandardGeneratorParams } from "../standardGenerator.js";

// ---------------------------------------------------------------------------
// Mock QuestionScorerService
// ---------------------------------------------------------------------------
vi.mock("../../../services/quiz/intelligence/index.js", () => ({
  QuestionScorerService: {
    isAcceptable: vi.fn().mockReturnValue({
      acceptable: true,
      score: { overall: 0.8 },
      duplicate: { isDuplicate: false, similarity: 0 },
    }),
  },
}));

// Re-import after mock so we can manipulate the mock in tests
import { QuestionScorerService } from "../../../services/quiz/intelligence/index.js";

// ---------------------------------------------------------------------------
// Mock logger to avoid side-effects
// ---------------------------------------------------------------------------
vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    type: QuestionType.MULTIPLE_CHOICE,
    question: "What is 2 + 2?",
    difficulty: "moyen",
    points: 1,
    options: [
      { id: "a", text: "3", isCorrect: false },
      { id: "b", text: "4", isCorrect: true },
      { id: "c", text: "5", isCorrect: false },
    ],
    ...overrides,
  } as Question;
}

function buildParams(overrides: Partial<StandardGeneratorParams> = {}): StandardGeneratorParams {
  return {
    questionCount: 3,
    typeDistribution: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION"],
    specialtyDistribution: [],
    baseRequest: { subject: "Maths", schoolLevel: "COLLEGE" },
    quizId: "quiz-123",
    sendSSE: vi.fn(),
    assistantService: {
      generateSingleQuestion: vi.fn().mockResolvedValue({ questions: [makeQuestion()] }),
    },
    prisma: {
      quiz: { update: vi.fn().mockResolvedValue({}) },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateQuestionsStandard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset scorer to default acceptable
    vi.mocked(QuestionScorerService.isAcceptable).mockReturnValue({
      acceptable: true,
      score: { overall: 0.8 } as ReturnType<typeof QuestionScorerService.scoreQuestion>,
      duplicate: { isDuplicate: false, similarity: 0 },
    });
  });

  // -------------------------------------------------------------------------
  // 1. Generates N questions sequentially and returns them
  // -------------------------------------------------------------------------
  it("generates N questions sequentially and returns them", async () => {
    const params = buildParams({ questionCount: 3 });
    const result = await generateQuestionsStandard(params);

    expect(result).toHaveLength(3);
    expect(params.assistantService.generateSingleQuestion).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // 2. Sends "question-generating" SSE before each question
  // -------------------------------------------------------------------------
  it("sends question-generating SSE before each question", async () => {
    const params = buildParams({ questionCount: 2 });
    await generateQuestionsStandard(params);

    const sendSSE = vi.mocked(params.sendSSE);
    const generatingCalls = sendSSE.mock.calls.filter(([event]) => event === "question-generating");
    expect(generatingCalls).toHaveLength(2);

    expect(generatingCalls[0][1]).toMatchObject({
      questionNumber: 1,
      totalQuestions: 2,
    });
    expect(generatingCalls[1][1]).toMatchObject({
      questionNumber: 2,
      totalQuestions: 2,
    });
  });

  // -------------------------------------------------------------------------
  // 3. Sends "question-generated" SSE with canStartAnswering=true for first
  // -------------------------------------------------------------------------
  it("sends question-generated SSE after each question with canStartAnswering=true for first", async () => {
    const params = buildParams({ questionCount: 2 });
    await generateQuestionsStandard(params);

    const sendSSE = vi.mocked(params.sendSSE);
    const generatedCalls = sendSSE.mock.calls.filter(([event]) => event === "question-generated");
    expect(generatedCalls).toHaveLength(2);

    // First question: canStartAnswering = true
    expect(generatedCalls[0][1]).toMatchObject({
      questionNumber: 1,
      canStartAnswering: true,
    });

    // Second question: canStartAnswering = false
    expect(generatedCalls[1][1]).toMatchObject({
      questionNumber: 2,
      canStartAnswering: false,
    });
  });

  // -------------------------------------------------------------------------
  // 4. Skips duplicate questions
  // -------------------------------------------------------------------------
  it("skips duplicate questions when scorer returns isDuplicate: true", async () => {
    // First question: acceptable. Second: duplicate. Third: acceptable.
    vi.mocked(QuestionScorerService.isAcceptable)
      .mockReturnValueOnce({
        acceptable: true,
        score: { overall: 0.8 } as ReturnType<typeof QuestionScorerService.scoreQuestion>,
        duplicate: { isDuplicate: false, similarity: 0 },
      })
      .mockReturnValueOnce({
        acceptable: false,
        score: { overall: 0.8 } as ReturnType<typeof QuestionScorerService.scoreQuestion>,
        duplicate: { isDuplicate: true, similarity: 0.95 },
      })
      .mockReturnValueOnce({
        acceptable: true,
        score: { overall: 0.8 } as ReturnType<typeof QuestionScorerService.scoreQuestion>,
        duplicate: { isDuplicate: false, similarity: 0 },
      });

    const params = buildParams({ questionCount: 3 });
    const result = await generateQuestionsStandard(params);

    // Only 2 accepted (second was duplicate)
    expect(result).toHaveLength(2);

    // DB update called only for the 2 accepted questions
    expect(params.prisma.quiz.update).toHaveBeenCalledTimes(2);

    // "question-skipped" SSE sent once
    const sendSSE = vi.mocked(params.sendSSE);
    const skippedCalls = sendSSE.mock.calls.filter(([event]) => event === "question-skipped");
    expect(skippedCalls).toHaveLength(1);
    expect(skippedCalls[0][1]).toMatchObject({ questionNumber: 2 });
  });

  // -------------------------------------------------------------------------
  // 5. Continues on error — first succeeds, second throws → returns 1
  // -------------------------------------------------------------------------
  it("continues on error and returns only successful questions", async () => {
    const genFn = vi
      .fn()
      .mockResolvedValueOnce({ questions: [makeQuestion()] })
      .mockRejectedValueOnce(new Error("LLM timeout"))
      .mockResolvedValueOnce({ questions: [makeQuestion()] });

    const params = buildParams({
      questionCount: 3,
      assistantService: { generateSingleQuestion: genFn },
    });

    const result = await generateQuestionsStandard(params);

    // 2 successful, 1 errored
    expect(result).toHaveLength(2);

    // "question-error" SSE sent once
    const sendSSE = vi.mocked(params.sendSSE);
    const errorCalls = sendSSE.mock.calls.filter(([event]) => event === "question-error");
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toMatchObject({
      questionNumber: 2,
      error: "Failed to generate question 2",
    });
  });

  // -------------------------------------------------------------------------
  // 6. Saves to DB after each question (prisma.quiz.update called N times)
  // -------------------------------------------------------------------------
  it("saves to DB after each accepted question", async () => {
    const params = buildParams({ questionCount: 3 });
    await generateQuestionsStandard(params);

    expect(params.prisma.quiz.update).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // 7. Applies specialty when available in specialtyDistribution
  // -------------------------------------------------------------------------
  it("applies specialty when available in specialtyDistribution", async () => {
    // Return a fresh object each call so mutations don't bleed across iterations
    const genFn = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ questions: [makeQuestion({ subject: undefined })] }),
      );

    const params = buildParams({
      questionCount: 2,
      specialtyDistribution: [LyceeSpecialty.MATHEMATIQUES, LyceeSpecialty.PHYSIQUE_CHIMIE],
      assistantService: { generateSingleQuestion: genFn },
    });

    const result = await generateQuestionsStandard(params);

    expect(result).toHaveLength(2);

    // The request should include specialty fields
    const firstCall = genFn.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall.lyceeSpecialty).toBe(LyceeSpecialty.MATHEMATIQUES);
    expect(firstCall.specialtyLabel).toBe("Mathématiques");

    const secondCall = genFn.mock.calls[1][0] as Record<string, unknown>;
    expect(secondCall.lyceeSpecialty).toBe(LyceeSpecialty.PHYSIQUE_CHIMIE);
    expect(secondCall.specialtyLabel).toBe("Physique-Chimie");

    // Metadata should include specialty info
    expect(result[0].metadata).toMatchObject({
      qualityScore: 0.8,
      specialty: LyceeSpecialty.MATHEMATIQUES,
      specialtyLabel: "Mathématiques",
    });
  });
});
