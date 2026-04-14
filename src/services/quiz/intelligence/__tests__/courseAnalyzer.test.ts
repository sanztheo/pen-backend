/**
 * CourseAnalyzer Tests
 * Validates concept map extraction logic, prompt construction, and Zod parsing.
 * Uses dependency injection (options.client) to avoid ESM module mocking issues.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  analyzeCourse,
  ConceptMapSchema,
  type ConceptMap,
  type ChatClient,
} from "../courseAnalyzer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_CONCEPT_MAP: ConceptMap = {
  title: "Introduction to Rust",
  summary:
    "This course covers Rust fundamentals including ownership, borrowing, and lifetimes. It provides a foundation for systems programming with memory safety guarantees.",
  totalConcepts: 3,
  concepts: [
    {
      name: "Ownership",
      importance: 5,
      section: "Memory Management",
      relatedConcepts: ["Borrowing", "Lifetimes"],
      description: "The core mechanism by which Rust manages memory without a garbage collector.",
    },
    {
      name: "Borrowing",
      importance: 4,
      section: "Memory Management",
      relatedConcepts: ["Ownership", "Lifetimes"],
      description: "Allows references to data without taking ownership, enabling shared access.",
    },
    {
      name: "Lifetimes",
      importance: 3,
      section: "Advanced Types",
      relatedConcepts: ["Ownership", "Borrowing"],
      description: "Annotations that tell the compiler how long references should remain valid.",
    },
  ],
};

const SAMPLE_COURSE_TEXT = `
# Introduction to Rust

Rust is a systems programming language focused on safety, speed, and concurrency.

## Memory Management

### Ownership
Every value in Rust has a variable that's called its owner. There can only be one
owner at a time. When the owner goes out of scope, the value will be dropped.

### Borrowing
References allow you to refer to some value without taking ownership of it.
You can have either one mutable reference or any number of immutable references.

## Advanced Types

### Lifetimes
Lifetimes are a way of telling the compiler how long references are valid.
They prevent dangling references and ensure memory safety at compile time.
`;

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
  content: ConceptMap | Record<string, unknown>,
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

describe("analyzeCourse", () => {
  let mockCreate: jest.Mock<CreateFn>;
  let mockClient: ChatClient;

  beforeEach(() => {
    mockCreate = jest.fn<CreateFn>();
    mockClient = buildMockClient(mockCreate);
  });

  const opts = () => ({ client: mockClient, model: TEST_MODEL });

  describe("successful analysis", () => {
    it("should return a valid ConceptMap from LLM response", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      const result = await analyzeCourse(SAMPLE_COURSE_TEXT, "Introduction to Rust", opts());

      expect(result.title).toBe("Introduction to Rust");
      expect(result.concepts).toHaveLength(3);
      expect(result.totalConcepts).toBe(3);
      expect(result.summary).toContain("Rust");
    });

    it("should pass Zod schema validation on the result", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      const result = await analyzeCourse(SAMPLE_COURSE_TEXT, "Introduction to Rust", opts());

      const validation = ConceptMapSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it("should correct totalConcepts mismatch", async () => {
      const mismatchedMap = { ...VALID_CONCEPT_MAP, totalConcepts: 99 };
      mockLLMResponse(mockCreate, mismatchedMap);

      const result = await analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts());

      expect(result.totalConcepts).toBe(3);
    });
  });

  describe("prompt construction", () => {
    it("should include course title and content in the LLM request", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      await analyzeCourse(SAMPLE_COURSE_TEXT, "Introduction to Rust", opts());

      expect(mockCreate).toHaveBeenCalledTimes(1);

      const callArgs = mockCreate.mock.calls[0];
      const params = callArgs[0];
      const messageContent = params.messages[0].content;

      expect(messageContent).toContain("Introduction to Rust");
      expect(messageContent).toContain("Ownership");
      expect(messageContent).toContain("Borrowing");
    });

    it("should request json_object response format", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      await analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts());

      const params = mockCreate.mock.calls[0][0];
      expect(params.response_format).toEqual({ type: "json_object" });
    });

    it("should use the provided model", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      await analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts());

      const params = mockCreate.mock.calls[0][0];
      expect(params.model).toBe(TEST_MODEL);
    });
  });

  describe("error handling", () => {
    it("should throw on empty course text", async () => {
      await expect(analyzeCourse("", "Empty", opts())).rejects.toThrow("Empty course text");
      await expect(analyzeCourse("   ", "Whitespace", opts())).rejects.toThrow("Empty course text");
    });

    it("should throw on empty LLM response", async () => {
      mockEmptyLLMResponse(mockCreate);

      await expect(analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts())).rejects.toThrow(
        "LLM returned empty response",
      );
    });

    it("should throw on invalid JSON from LLM", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "not json" } }],
      });

      await expect(analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts())).rejects.toThrow();
    });

    it("should throw on schema-invalid LLM response", async () => {
      mockLLMResponse(mockCreate, {
        title: "Rust",
        summary: "A course",
        totalConcepts: 1,
        concepts: [
          {
            name: "Ownership",
            // Missing: importance, section, relatedConcepts, description
          },
        ],
      });

      await expect(analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts())).rejects.toThrow(
        "Invalid concept map structure",
      );
    });
  });

  describe("concept structure", () => {
    it("should have valid importance values (1-5)", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      const result = await analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts());

      for (const concept of result.concepts) {
        expect(concept.importance).toBeGreaterThanOrEqual(1);
        expect(concept.importance).toBeLessThanOrEqual(5);
      }
    });

    it("should have relatedConcepts referencing other concepts in the map", async () => {
      mockLLMResponse(mockCreate, VALID_CONCEPT_MAP);

      const result = await analyzeCourse(SAMPLE_COURSE_TEXT, "Rust", opts());
      const conceptNames = new Set(result.concepts.map((c) => c.name));

      for (const concept of result.concepts) {
        for (const related of concept.relatedConcepts) {
          expect(conceptNames.has(related)).toBe(true);
        }
      }
    });
  });
});
