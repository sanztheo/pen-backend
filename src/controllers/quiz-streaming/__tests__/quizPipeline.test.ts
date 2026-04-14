/**
 * QuizPipeline Tests
 * Validates the 4-stage pipeline orchestration: Analyze → Plan → Generate → Done.
 * Uses jest.unstable_mockModule for ESM module mocking.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import type { Question } from "../../../services/quiz/types.js";
import type { ConceptMap } from "../../../services/quiz/intelligence/courseAnalyzer.js";
import type {
  QuizBlueprint,
  PlannedQuestion,
} from "../../../services/quiz/intelligence/quizPlanner.js";
import type { SSESender } from "../types.js";

// ---------------------------------------------------------------------------
// Mocks — must be set up before dynamic import of the module under test
// ---------------------------------------------------------------------------

const mockAnalyzeCourse = jest.fn<() => Promise<ConceptMap>>();
const mockPlanQuiz = jest.fn<() => Promise<QuizBlueprint>>();
const mockGenerateBatch = jest.fn<() => Promise<Question[]>>();
const mockExtractPageText = jest.fn<() => { courseText: string; courseTitle: string }>();

jest.unstable_mockModule("../../../services/quiz/intelligence/courseAnalyzer.js", () => ({
  analyzeCourse: mockAnalyzeCourse,
}));

jest.unstable_mockModule("../../../services/quiz/intelligence/quizPlanner.js", () => ({
  planQuiz: mockPlanQuiz,
}));

jest.unstable_mockModule("../batchQuestionGenerator.js", () => ({
  generateBatch: mockGenerateBatch,
}));

jest.unstable_mockModule("../extractPageText.js", () => ({
  extractPageText: mockExtractPageText,
}));

jest.unstable_mockModule("../../../utils/logger.js", () => ({
  logger: { log: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Dynamic import after mocks
const { executeQuizPipeline } = await import("../quizPipeline.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlannedQuestion(
  index: number,
  overrides: Partial<PlannedQuestion> = {},
): PlannedQuestion {
  return {
    index,
    targetConcept: `Concept ${index}`,
    questionType: "MULTIPLE_CHOICE",
    difficulty: "moyen",
    bloomLevel: "comprehension",
    angle: `Test angle for concept ${index}`,
    ...overrides,
  };
}

function makeQuestion(index: number): Question {
  return {
    id: `q_${index}`,
    type: "MULTIPLE_CHOICE",
    question: `Question ${index}?`,
    difficulty: "moyen",
    points: 1,
    options: [
      { id: "A", text: "Option A", isCorrect: true },
      { id: "B", text: "Option B", isCorrect: false },
      { id: "C", text: "Option C", isCorrect: false },
      { id: "D", text: "Option D", isCorrect: false },
    ],
    leftColumn: [],
    rightColumn: [],
    correctMatches: [],
    expectedAnswer: "",
    subject: "Test",
    schoolLevel: "COLLEGE",
    hasGraphic: false,
    graphicId: "",
    graphicLibrary: "apexcharts",
    graphicType: "2d",
    basedOnDocument: false,
    documentReference: "",
  } as unknown as Question;
}

function makeConceptMap(count: number): ConceptMap {
  return {
    title: "Test Course",
    summary: "A test course for unit testing",
    totalConcepts: count,
    concepts: Array.from({ length: count }, (_, i) => ({
      name: `Concept ${i + 1}`,
      importance: 3 as const,
      section: "Test Section",
      relatedConcepts: [],
      description: `Description of concept ${i + 1}`,
    })),
  };
}

function makeBlueprint(count: number): QuizBlueprint {
  return {
    totalQuestions: count,
    distribution: {
      byDifficulty: { facile: 2, moyen: count - 4, difficile: 2 },
      byType: { MULTIPLE_CHOICE: count },
      byBloom: { recall: 2, comprehension: count - 4, application: 1, analysis: 1 },
    },
    questions: Array.from({ length: count }, (_, i) => makePlannedQuestion(i + 1)),
  };
}

function buildPipelineParams(
  overrides: Record<string, unknown> = {},
): Parameters<typeof executeQuizPipeline>[0] {
  return {
    pageIds: ["page-1", "page-2"],
    questionCount: 10,
    questionTypes: ["MULTIPLE_CHOICE"],
    difficulty: "moyen",
    schoolLevel: "COLLEGE",
    quizId: "quiz-test-1",
    sendSSE: jest.fn() as unknown as SSESender,
    prisma: {
      page: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
          { id: "page-1", title: "Page 1", blockNoteContent: [] },
          { id: "page-2", title: "Page 2", blockNoteContent: [] },
        ]),
      },
      quiz: {
        update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockExtractPageText.mockReturnValue({
    courseText: "Full course text content here",
    courseTitle: "Page 1 + Page 2",
  });

  mockAnalyzeCourse.mockResolvedValue(makeConceptMap(10));
  mockPlanQuiz.mockResolvedValue(makeBlueprint(10));

  // Default: generateBatch returns N questions matching the batch size
  mockGenerateBatch.mockImplementation(async (req: unknown) => {
    const r = req as { plannedQuestions: PlannedQuestion[] };
    return r.plannedQuestions.map((_, i) => makeQuestion(i + 1));
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeQuizPipeline", () => {
  describe("full pipeline", () => {
    it("should generate all questions and emit SSE events in correct order", async () => {
      const params = buildPipelineParams({ questionCount: 10 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(10));

      const result = await executeQuizPipeline(params);

      // Should return 10 questions
      expect(result).toHaveLength(10);

      // Verify SSE events order
      const sendSSE = params.sendSSE as unknown as jest.Mock;
      const eventNames = sendSSE.mock.calls.map((c: unknown[]) => c[0]);

      expect(eventNames[0]).toBe("analyzing");
      expect(eventNames[1]).toBe("planning");
      expect(eventNames[2]).toBe("generating");

      // After "generating", should have question-generated events
      const questionEvents = eventNames.filter((e: string) => e === "question-generated");
      expect(questionEvents).toHaveLength(10);
    });

    it("should call analyzeCourse and planQuiz with correct args", async () => {
      const params = buildPipelineParams();
      await executeQuizPipeline(params);

      expect(mockAnalyzeCourse).toHaveBeenCalledWith(
        "Full course text content here",
        "Page 1 + Page 2",
      );
      expect(mockPlanQuiz).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Test Course" }),
        expect.objectContaining({ questionCount: 10, questionTypes: ["MULTIPLE_CHOICE"] }),
      );
    });

    it("should save to DB after each batch", async () => {
      const params = buildPipelineParams({ questionCount: 10 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(10));

      await executeQuizPipeline(params);

      // 10 questions / 5 per batch = 2 batches = 2 DB saves
      const quizUpdate = params.prisma.quiz.update as jest.Mock;
      expect(quizUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe("batch sizing", () => {
    it("should split 7 questions into 1 batch of 5 + 1 batch of 2", async () => {
      const params = buildPipelineParams({ questionCount: 7 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(7));

      await executeQuizPipeline(params);

      // generateBatch called twice
      expect(mockGenerateBatch).toHaveBeenCalledTimes(2);

      // First batch: 5 planned questions
      const firstCall = mockGenerateBatch.mock.calls[0] as unknown[];
      const firstReq = firstCall[0] as { plannedQuestions: PlannedQuestion[] };
      expect(firstReq.plannedQuestions).toHaveLength(5);

      // Second batch: 2 planned questions
      const secondCall = mockGenerateBatch.mock.calls[1] as unknown[];
      const secondReq = secondCall[0] as { plannedQuestions: PlannedQuestion[] };
      expect(secondReq.plannedQuestions).toHaveLength(2);
    });

    it("should handle exactly 5 questions in a single batch", async () => {
      const params = buildPipelineParams({ questionCount: 5 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(5));

      await executeQuizPipeline(params);

      expect(mockGenerateBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should throw on analyze stage error and emit SSE error", async () => {
      mockAnalyzeCourse.mockRejectedValue(new Error("LLM timeout"));
      const params = buildPipelineParams();

      await expect(executeQuizPipeline(params)).rejects.toThrow("LLM timeout");
    });

    it("should throw when no pages found", async () => {
      const params = buildPipelineParams();
      (params.prisma.page.findMany as jest.Mock).mockResolvedValue([]);

      await expect(executeQuizPipeline(params)).rejects.toThrow("No pages found");
    });

    it("should save partial results when batch 3 fails (10 questions saved)", async () => {
      const params = buildPipelineParams({ questionCount: 15 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(15));

      let callCount = 0;
      mockGenerateBatch.mockImplementation(async (req: unknown) => {
        callCount++;
        if (callCount === 3) {
          throw new Error("Batch 3 LLM failure");
        }
        const r = req as { plannedQuestions: PlannedQuestion[] };
        return r.plannedQuestions.map((_, i) => makeQuestion(i + 1));
      });

      await expect(executeQuizPipeline(params)).rejects.toThrow("Batch 3 LLM failure");

      // Should have saved partial results (batches 1 and 2 = 10 questions)
      const quizUpdate = params.prisma.quiz.update as jest.Mock;
      // 2 successful batch saves + 1 emergency save before re-throw = 3
      expect(quizUpdate).toHaveBeenCalledTimes(3);

      // The emergency save should contain 10 questions
      const lastSaveCall = quizUpdate.mock.calls[2] as unknown[];
      const lastSaveArgs = lastSaveCall[0] as { data: { questions: Question[] } };
      expect(lastSaveArgs.data.questions).toHaveLength(10);
    });
  });

  describe("canStartAnswering", () => {
    it("should be true only on the first question of the first batch", async () => {
      const params = buildPipelineParams({ questionCount: 10 });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(10));

      await executeQuizPipeline(params);

      const sendSSE = params.sendSSE as unknown as jest.Mock;
      const questionGenCalls = sendSSE.mock.calls.filter(
        (c: unknown[]) => c[0] === "question-generated",
      );

      // First question: canStartAnswering = true
      const firstData = questionGenCalls[0][1] as { canStartAnswering: boolean };
      expect(firstData.canStartAnswering).toBe(true);

      // All others: canStartAnswering = false
      for (let i = 1; i < questionGenCalls.length; i++) {
        const data = questionGenCalls[i][1] as { canStartAnswering: boolean };
        expect(data.canStartAnswering).toBe(false);
      }
    });
  });

  describe("client disconnection", () => {
    it("should stop generating when client disconnects", async () => {
      let batchCount = 0;
      const params = buildPipelineParams({
        questionCount: 15,
        isDisconnected: () => batchCount >= 1,
      });
      mockPlanQuiz.mockResolvedValue(makeBlueprint(15));

      mockGenerateBatch.mockImplementation(async (req: unknown) => {
        batchCount++;
        const r = req as { plannedQuestions: PlannedQuestion[] };
        return r.plannedQuestions.map((_, i) => makeQuestion(i + 1));
      });

      const result = await executeQuizPipeline(params);

      // Only first batch should have run before disconnection detected
      expect(mockGenerateBatch).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(5);
    });
  });
});
