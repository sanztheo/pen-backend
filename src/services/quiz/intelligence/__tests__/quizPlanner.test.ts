/**
 * QuizPlanner Tests
 * Validates blueprint generation logic, distribution rules, and Zod parsing.
 * Uses dependency injection (options.client) to avoid ESM module mocking issues.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  planQuiz,
  QuizBlueprintSchema,
  type QuizBlueprint,
  type QuizPlanConfig,
  type PlannedQuestion,
} from "../quizPlanner.js";
import type { ConceptMap, ChatClient } from "../courseAnalyzer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_CONCEPT_MAP: ConceptMap = {
  title: "Introduction to Rust",
  summary: "Covers Rust fundamentals: ownership, borrowing, lifetimes, and pattern matching.",
  totalConcepts: 4,
  concepts: [
    {
      name: "Ownership",
      importance: 5,
      section: "Memory Management",
      relatedConcepts: ["Borrowing", "Lifetimes"],
      description: "Core mechanism for memory management without GC.",
    },
    {
      name: "Borrowing",
      importance: 4,
      section: "Memory Management",
      relatedConcepts: ["Ownership", "Lifetimes"],
      description: "Shared or exclusive references to data without taking ownership.",
    },
    {
      name: "Lifetimes",
      importance: 3,
      section: "Advanced Types",
      relatedConcepts: ["Ownership", "Borrowing"],
      description: "Annotations ensuring references remain valid.",
    },
    {
      name: "Pattern Matching",
      importance: 2,
      section: "Control Flow",
      relatedConcepts: ["Ownership"],
      description: "Destructuring and matching values with match expressions.",
    },
  ],
};

const DEFAULT_CONFIG: QuizPlanConfig = {
  questionCount: 10,
  questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
};

function buildValidBlueprint(
  questionCount: number,
  questionTypes: string[],
  concepts: ConceptMap["concepts"],
): QuizBlueprint {
  const questions: PlannedQuestion[] = [];
  for (let i = 0; i < questionCount; i++) {
    const concept = concepts[i % concepts.length];
    questions.push({
      index: i + 1,
      targetConcept: concept.name,
      questionType: questionTypes[i % questionTypes.length],
      difficulty: (["facile", "moyen", "difficile"] as const)[i % 3],
      bloomLevel: (["recall", "comprehension", "application", "analysis"] as const)[i % 4],
      angle: `Tests ${concept.name} from angle ${i + 1}`,
    });
  }

  const byDifficulty: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byBloom: Record<string, number> = {};

  for (const q of questions) {
    byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
    byType[q.questionType] = (byType[q.questionType] ?? 0) + 1;
    byBloom[q.bloomLevel] = (byBloom[q.bloomLevel] ?? 0) + 1;
  }

  return {
    totalQuestions: questionCount,
    distribution: { byDifficulty, byType, byBloom },
    questions,
  };
}

const TEST_MODEL = "gemini-3-flash-preview";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

type CreateFn = ChatClient["chat"]["completions"]["create"];

function buildMockClient(createFn: jest.Mock<CreateFn>): ChatClient {
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
  };
}

function mockLLMResponse(
  mockCreate: jest.Mock<CreateFn>,
  content: QuizBlueprint | Record<string, unknown>,
): void {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

function mockEmptyLLMResponse(mockCreate: jest.Mock<CreateFn>): void {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: null } }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("planQuiz", () => {
  let mockCreate: jest.Mock<CreateFn>;
  let mockClient: ChatClient;

  beforeEach(() => {
    mockCreate = jest.fn<CreateFn>();
    mockClient = buildMockClient(mockCreate);
  });

  const opts = () => ({ client: mockClient, model: TEST_MODEL });

  // -----------------------------------------------------------------------
  // 1. Happy path: structure validation
  // -----------------------------------------------------------------------
  describe("happy path", () => {
    it("should return a valid QuizBlueprint with correct question count", async () => {
      const blueprint = buildValidBlueprint(
        DEFAULT_CONFIG.questionCount,
        DEFAULT_CONFIG.questionTypes,
        SAMPLE_CONCEPT_MAP.concepts,
      );
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      expect(result.totalQuestions).toBe(10);
      expect(result.questions).toHaveLength(10);
      expect(result.distribution).toBeDefined();
      expect(result.distribution.byDifficulty).toBeDefined();
      expect(result.distribution.byType).toBeDefined();
      expect(result.distribution.byBloom).toBeDefined();
    });

    it("should pass Zod schema validation on the result", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      const validation = QuizBlueprintSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it("should correct totalQuestions mismatch", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      blueprint.totalQuestions = 99;
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      expect(result.totalQuestions).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // 2. All concepts covered
  // -----------------------------------------------------------------------
  describe("concept coverage", () => {
    it("should cover all concepts from the concept map", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      const coveredConcepts = new Set(result.questions.map((q) => q.targetConcept));
      for (const concept of SAMPLE_CONCEPT_MAP.concepts) {
        expect(coveredConcepts.has(concept.name)).toBe(true);
      }
    });

    it("should have every targetConcept matching a concept in the map", async () => {
      const blueprint = buildValidBlueprint(10, ["TRUE_FALSE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      const validNames = new Set(SAMPLE_CONCEPT_MAP.concepts.map((c) => c.name));
      for (const q of result.questions) {
        expect(validNames.has(q.targetConcept)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. Type distribution respects config
  // -----------------------------------------------------------------------
  describe("type distribution", () => {
    it("should only use question types from the config", async () => {
      const config: QuizPlanConfig = {
        questionCount: 8,
        questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
      };
      const blueprint = buildValidBlueprint(8, config.questionTypes, SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, config, opts());

      const allowedTypes = new Set(config.questionTypes);
      for (const q of result.questions) {
        expect(allowedTypes.has(q.questionType)).toBe(true);
      }
    });

    it("should include allowed types in prompt", async () => {
      const config: QuizPlanConfig = {
        questionCount: 5,
        questionTypes: ["OPEN_QUESTION", "MATCHING"],
      };
      const blueprint = buildValidBlueprint(5, config.questionTypes, SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, config, opts());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("OPEN_QUESTION");
      expect(prompt).toContain("MATCHING");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Total question count
  // -----------------------------------------------------------------------
  describe("question count", () => {
    it("should return exactly config.questionCount questions", async () => {
      const config: QuizPlanConfig = {
        questionCount: 20,
        questionTypes: ["MULTIPLE_CHOICE"],
      };
      const blueprint = buildValidBlueprint(20, config.questionTypes, SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      const result = await planQuiz(SAMPLE_CONCEPT_MAP, config, opts());

      expect(result.questions).toHaveLength(20);
      expect(result.totalQuestions).toBe(20);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Prompt construction
  // -----------------------------------------------------------------------
  describe("prompt construction", () => {
    it("should include concept names and the course title in the prompt", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("Introduction to Rust");
      expect(prompt).toContain("Ownership");
      expect(prompt).toContain("Borrowing");
      expect(prompt).toContain("Lifetimes");
      expect(prompt).toContain("Pattern Matching");
    });

    it("should request json_object response format", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      const params = mockCreate.mock.calls[0][0];
      expect(params.response_format).toEqual({ type: "json_object" });
    });

    it("should use the provided model", async () => {
      const blueprint = buildValidBlueprint(10, ["MULTIPLE_CHOICE"], SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts());

      expect(mockCreate.mock.calls[0][0].model).toBe(TEST_MODEL);
    });

    it("should include difficulty hint when config.difficulty is set", async () => {
      const config: QuizPlanConfig = {
        questionCount: 5,
        questionTypes: ["MULTIPLE_CHOICE"],
        difficulty: "difficile",
      };
      const blueprint = buildValidBlueprint(5, config.questionTypes, SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, config, opts());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("difficile");
    });

    it("should include school level when config.schoolLevel is set", async () => {
      const config: QuizPlanConfig = {
        questionCount: 5,
        questionTypes: ["TRUE_FALSE"],
        schoolLevel: "LYCEE_TERMINALE",
      };
      const blueprint = buildValidBlueprint(5, config.questionTypes, SAMPLE_CONCEPT_MAP.concepts);
      mockLLMResponse(mockCreate, blueprint);

      await planQuiz(SAMPLE_CONCEPT_MAP, config, opts());

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("LYCEE_TERMINALE");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("should throw on empty concept map", async () => {
      const emptyMap: ConceptMap = {
        title: "Empty",
        summary: "Nothing here",
        totalConcepts: 0,
        concepts: [],
      };

      await expect(planQuiz(emptyMap, DEFAULT_CONFIG, opts())).rejects.toThrow(
        "Concept map has no concepts",
      );
    });

    it("should throw on empty LLM response", async () => {
      mockEmptyLLMResponse(mockCreate);

      await expect(planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts())).rejects.toThrow(
        "LLM returned empty response",
      );
    });

    it("should throw on invalid JSON from LLM", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "not valid json at all" } }],
      });

      await expect(planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts())).rejects.toThrow();
    });

    it("should throw on schema-invalid LLM response", async () => {
      mockLLMResponse(mockCreate, {
        totalQuestions: 1,
        distribution: { byDifficulty: {}, byType: {}, byBloom: {} },
        questions: [
          {
            index: 1,
            targetConcept: "Ownership",
            // Missing: questionType, difficulty, bloomLevel, angle
          },
        ],
      });

      await expect(planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts())).rejects.toThrow(
        "Invalid blueprint structure",
      );
    });

    it("should throw when LLM client rejects", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API rate limit exceeded"));

      await expect(planQuiz(SAMPLE_CONCEPT_MAP, DEFAULT_CONFIG, opts())).rejects.toThrow(
        "API rate limit exceeded",
      );
    });
  });
});
