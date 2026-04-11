import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Question } from "../../../services/quiz/types.js";
import type { ClusterQuestionDistribution } from "../../../services/quiz/intelligence/index.js";
import type { IntelligentGeneratorParams } from "../intelligentGenerator.js";

// ---------------------------------------------------------------------------
// Mocks
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

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../utils.js", () => ({
  getSpecialtyLabel: vi.fn((s: string) => `Label-${s}`),
}));

// Import after mocks
import { generateQuestionsIntelligent } from "../intelligentGenerator.js";
import { QuestionScorerService } from "../../../services/quiz/intelligence/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    type: "MULTIPLE_CHOICE" as unknown as Question["type"],
    question: "What is 2+2?",
    difficulty: "moyen",
    points: 1,
    options: [
      { id: "a", text: "3", isCorrect: false },
      { id: "b", text: "4", isCorrect: true },
    ],
    ...overrides,
  } as Question;
}

function makeCluster(
  overrides: Partial<ClusterQuestionDistribution> = {},
): ClusterQuestionDistribution {
  return {
    clusterId: "cluster-1",
    clusterName: "Algebra",
    keywords: ["equations", "variables"],
    questionCount: 2,
    content: "Algebra RAG content here",
    pageIds: ["page-1"],
    ...overrides,
  };
}

function buildParams(
  overrides: Partial<IntelligentGeneratorParams> = {},
): IntelligentGeneratorParams {
  return {
    questionCount: 4,
    questionDistribution: [
      makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 2 }),
      makeCluster({
        clusterId: "c2",
        clusterName: "Geometry",
        questionCount: 2,
        content: "Geometry RAG content",
        keywords: ["shapes", "angles"],
      }),
    ],
    typeDistribution: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
    specialtyDistribution: [],
    baseRequest: { subject: "math", schoolLevel: "LYCEE_PREMIERE" },
    quizId: "quiz-1",
    sendSSE: vi.fn(),
    assistantService: {
      generateSingleQuestion: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ questions: [makeQuestion()] })),
    },
    prisma: { quiz: { update: vi.fn().mockResolvedValue({}) } },
    scorerOptions: { minScore: 0.5, duplicateThreshold: 0.85 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateQuestionsIntelligent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock return for scorer
    (QuestionScorerService.isAcceptable as ReturnType<typeof vi.fn>).mockReturnValue({
      acceptable: true,
      score: { overall: 0.8 },
      duplicate: { isDuplicate: false, similarity: 0 },
    });
  });

  // -------------------------------------------------------------------------
  // 1. Generates questions across clusters
  // -------------------------------------------------------------------------
  it("generates questions across clusters", async () => {
    const params = buildParams();
    const result = await generateQuestionsIntelligent(params);

    // 2 clusters x 2 questions each = 4
    expect(result).toHaveLength(4);
    expect(params.assistantService.generateSingleQuestion).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // 2. Sends cluster-start and cluster-complete SSE for each cluster
  // -------------------------------------------------------------------------
  it("sends cluster-start and cluster-complete SSE for each cluster", async () => {
    const params = buildParams();
    await generateQuestionsIntelligent(params);

    const sseCalls = (params.sendSSE as ReturnType<typeof vi.fn>).mock.calls;
    const clusterStartCalls = sseCalls.filter(([event]: [string]) => event === "cluster-start");
    const clusterCompleteCalls = sseCalls.filter(
      ([event]: [string]) => event === "cluster-complete",
    );

    expect(clusterStartCalls).toHaveLength(2);
    expect(clusterCompleteCalls).toHaveLength(2);

    // First cluster
    expect(clusterStartCalls[0][1]).toMatchObject({
      clusterName: "Algebra",
      clusterIndex: 0,
      totalClusters: 2,
      questionCount: 2,
    });

    // Second cluster
    expect(clusterStartCalls[1][1]).toMatchObject({
      clusterName: "Geometry",
      clusterIndex: 1,
      totalClusters: 2,
      questionCount: 2,
    });

    // Complete events report questions generated
    expect(clusterCompleteCalls[0][1]).toMatchObject({
      clusterName: "Algebra",
      clusterIndex: 0,
      questionsGenerated: 2,
    });
    expect(clusterCompleteCalls[1][1]).toMatchObject({
      clusterName: "Geometry",
      clusterIndex: 1,
      questionsGenerated: 2,
    });
  });

  // -------------------------------------------------------------------------
  // 3. Distributes questions correctly among clusters
  // -------------------------------------------------------------------------
  it("distributes questions correctly among clusters", async () => {
    const params = buildParams({
      questionCount: 5,
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "A", questionCount: 3 }),
        makeCluster({ clusterId: "c2", clusterName: "B", questionCount: 2 }),
      ],
    });

    const result = await generateQuestionsIntelligent(params);
    expect(result).toHaveLength(5);
    expect(params.assistantService.generateSingleQuestion).toHaveBeenCalledTimes(5);

    const sseCalls = (params.sendSSE as ReturnType<typeof vi.fn>).mock.calls;
    const completeCalls = sseCalls.filter(([event]: [string]) => event === "cluster-complete");
    expect(completeCalls[0][1].questionsGenerated).toBe(3);
    expect(completeCalls[1][1].questionsGenerated).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 4. Adds cluster metadata to questions
  // -------------------------------------------------------------------------
  it("adds cluster metadata to questions (clusterName, clusterId, qualityScore)", async () => {
    const params = buildParams({
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 1 }),
      ],
      questionCount: 1,
    });

    const result = await generateQuestionsIntelligent(params);

    expect(result[0].metadata).toMatchObject({
      cluster: "Algebra",
      clusterId: "c1",
      qualityScore: 0.8,
    });
  });

  // -------------------------------------------------------------------------
  // 5. Uses cluster-specific content as ragContext
  // -------------------------------------------------------------------------
  it("uses cluster-specific content as ragContext", async () => {
    const params = buildParams({
      questionDistribution: [
        makeCluster({
          clusterId: "c1",
          clusterName: "Algebra",
          questionCount: 1,
          content: "Specific algebra content for RAG",
          keywords: ["linear", "quadratic"],
        }),
      ],
      questionCount: 1,
    });

    await generateQuestionsIntelligent(params);

    const generateCall = (
      params.assistantService.generateSingleQuestion as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(generateCall.ragContext).toBe("Specific algebra content for RAG");
    expect(generateCall.themeHint).toContain("Algebra");
    expect(generateCall.themeHint).toContain("linear");
    expect(generateCall.themeHint).toContain("quadratic");
  });

  // -------------------------------------------------------------------------
  // 6. Skips duplicate questions
  // -------------------------------------------------------------------------
  it("skips duplicate questions", async () => {
    (QuestionScorerService.isAcceptable as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        acceptable: true,
        score: { overall: 0.8 },
        duplicate: { isDuplicate: false, similarity: 0 },
      })
      .mockReturnValueOnce({
        acceptable: false,
        score: { overall: 0.8 },
        duplicate: { isDuplicate: true, similarity: 0.95 },
      });

    const params = buildParams({
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 2 }),
      ],
      questionCount: 2,
    });

    const result = await generateQuestionsIntelligent(params);

    // Only the first question is kept; the second is a duplicate
    expect(result).toHaveLength(1);

    // DB update only called once (for the accepted question)
    expect(params.prisma.quiz.update).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 7. Handles error in single question without stopping
  // -------------------------------------------------------------------------
  it("handles error in single question without stopping generation", async () => {
    const mockGenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error("LLM timeout"))
      .mockResolvedValueOnce({ questions: [makeQuestion()] })
      .mockResolvedValueOnce({ questions: [makeQuestion()] });

    const params = buildParams({
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 3 }),
      ],
      questionCount: 3,
      assistantService: { generateSingleQuestion: mockGenerate },
    });

    const result = await generateQuestionsIntelligent(params);

    // First question errored, other 2 succeeded
    expect(result).toHaveLength(2);
    expect(mockGenerate).toHaveBeenCalledTimes(3);

    // Error SSE was sent
    const sseCalls = (params.sendSSE as ReturnType<typeof vi.fn>).mock.calls;
    const errorCalls = sseCalls.filter(([event]: [string]) => event === "question-error");
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1].error).toContain("question 1");
  });

  // -------------------------------------------------------------------------
  // 8. Accepts low-quality non-duplicate questions with warning
  // -------------------------------------------------------------------------
  it("accepts low-quality non-duplicate questions with warning", async () => {
    (QuestionScorerService.isAcceptable as ReturnType<typeof vi.fn>).mockReturnValue({
      acceptable: false,
      score: { overall: 0.3 },
      duplicate: { isDuplicate: false, similarity: 0.1 },
    });

    const params = buildParams({
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 1 }),
      ],
      questionCount: 1,
    });

    const result = await generateQuestionsIntelligent(params);

    // Accepted despite low quality because it is not a duplicate
    expect(result).toHaveLength(1);
    expect(result[0].metadata?.qualityScore).toBe(0.3);
  });

  // -------------------------------------------------------------------------
  // 9. Applies specialty when specialtyDistribution is provided
  // -------------------------------------------------------------------------
  it("applies specialty from specialtyDistribution", async () => {
    const params = buildParams({
      questionDistribution: [
        makeCluster({ clusterId: "c1", clusterName: "Algebra", questionCount: 1 }),
      ],
      questionCount: 1,
      specialtyDistribution: [
        "MATHEMATIQUES" as unknown as import("../../../services/quiz/types.js").LyceeSpecialty,
      ],
    });

    await generateQuestionsIntelligent(params);

    const generateCall = (
      params.assistantService.generateSingleQuestion as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(generateCall.lyceeSpecialty).toBe("MATHEMATIQUES");
    expect(generateCall.specialtyLabel).toBe("Label-MATHEMATIQUES");
  });
});
