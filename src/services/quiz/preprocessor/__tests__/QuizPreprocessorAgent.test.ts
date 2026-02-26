/**
 * 🧪 Quiz Preprocessor Agent Tests - PEN-37
 * Tests avec mocks OpenAI pour l'agent de préprocessing
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { QuizPreprocessorAgent } from "../QuizPreprocessorAgent.js";
import type { PreprocessorPromptParams } from "../prompts.js";
import OpenAI from "openai";
import { quizLimitValidator } from "../limitValidator.js";

// Mock quizLimitValidator
const mockValidator = quizLimitValidator as any;

describe("QuizPreprocessorAgent - Constructor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should throw if OPENAI_API_KEY is missing", () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => new QuizPreprocessorAgent()).toThrow("OPENAI_API_KEY manquant dans Infisical");

    process.env.OPENAI_API_KEY = originalKey;
  });

  it("should initialize with valid API key", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";

    expect(() => new QuizPreprocessorAgent()).not.toThrow();
  });
});

describe("QuizPreprocessorAgent - analyzeAndRecommend", () => {
  let agent: QuizPreprocessorAgent;
  let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-key";

    // Mock OpenAI instance
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<OpenAI>;

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI);

    agent = new QuizPreprocessorAgent();

    // Mock validator
    mockValidator.validateAndCorrect.mockResolvedValue({
      isValid: true,
      correctedOutput: {
        recommendedQuestionCount: 10,
        questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE"],
        difficulty: "medium",
        suggestedTimeLimit: 15,
        reasoning: "Test quiz",
      },
      corrections: [],
      upgradeRequired: false,
    });
  });

  it("should successfully parse valid JSON response", async () => {
    const mockResponse = {
      recommendedQuestions: 10,
      questionTypes: {
        multipleChoice: 50,
        trueFalse: 30,
        openEnded: 10,
        matching: 10,
      },
      difficulty: "medium",
      suggestedDuration: 15,
      contentCoverage: "balanced",
      reasoning: "Balanced quiz for revision",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "REVISION",
      sourceSummary: "Test content",
      sourceTopics: ["topic1"],
      wordCount: 800,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 10,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result).toBeDefined();
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 800,
      }),
      expect.objectContaining({
        timeout: 10000,
      }),
    );
  });

  it("should parse JSON wrapped in markdown code blocks", async () => {
    const mockResponse = {
      recommendedQuestions: 8,
      questionTypes: {
        multipleChoice: 60,
        trueFalse: 40,
        openEnded: 0,
        matching: 0,
      },
      difficulty: "easy",
      suggestedDuration: 12,
      contentCoverage: "focused",
      reasoning: "Simple quiz",
    };

    const wrappedContent = `\`\`\`json
${JSON.stringify(mockResponse)}
\`\`\``;

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: wrappedContent,
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "6ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Basic content",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result).toBeDefined();
  });

  it("should parse JSON wrapped in generic code blocks", async () => {
    const mockResponse = {
      recommendedQuestions: 15,
      questionTypes: {
        multipleChoice: 40,
        trueFalse: 20,
        openEnded: 30,
        matching: 10,
      },
      difficulty: "hard",
      suggestedDuration: 30,
      contentCoverage: "comprehensive",
      reasoning: "Complex content",
    };

    const wrappedContent = `\`\`\`
${JSON.stringify(mockResponse)}
\`\`\``;

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: wrappedContent,
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "Terminale",
      studyLevel: "Lycée",
      quizType: "EXAMEN",
      sourceSummary: "Advanced physics",
      sourceTopics: ["quantum", "relativity"],
      wordCount: 3000,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 25,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result).toBeDefined();
  });

  it("should throw on empty response", async () => {
    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    await expect(agent.analyzeAndRecommend(params, "user-1")).rejects.toThrow(
      "Empty response from OpenAI",
    );
  });

  it("should throw on invalid JSON", async () => {
    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: "This is not valid JSON",
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    await expect(agent.analyzeAndRecommend(params, "user-1")).rejects.toThrow(
      "Failed to parse AI response as JSON",
    );
  });

  it("should throw if percentages don't sum to 100", async () => {
    const invalidResponse = {
      recommendedQuestions: 10,
      questionTypes: {
        multipleChoice: 40,
        trueFalse: 30,
        openEnded: 10,
        matching: 15, // Sum = 95, not 100
      },
      difficulty: "medium",
      suggestedDuration: 15,
      contentCoverage: "balanced",
      reasoning: "Test",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(invalidResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    await expect(agent.analyzeAndRecommend(params, "user-1")).rejects.toThrow("must sum to 100");
  });

  it("should throw if missing required fields", async () => {
    const incompleteResponse = {
      recommendedQuestions: 10,
      // Missing questionTypes
      difficulty: "medium",
      suggestedDuration: 15,
      contentCoverage: "balanced",
      reasoning: "Test",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(incompleteResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    await expect(agent.analyzeAndRecommend(params, "user-1")).rejects.toThrow(
      "Invalid AI response schema",
    );
  });

  it("should convert percentages to question types array", async () => {
    const mockResponse = {
      recommendedQuestions: 10,
      questionTypes: {
        multipleChoice: 40, // 4 questions
        trueFalse: 30, // 3 questions
        openEnded: 20, // 2 questions
        matching: 10, // 1 question
      },
      difficulty: "medium",
      suggestedDuration: 20,
      contentCoverage: "balanced",
      reasoning: "Mixed types",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    mockValidator.validateAndCorrect.mockImplementation(async (output) => ({
      isValid: true,
      correctedOutput: output,
      corrections: [],
      upgradeRequired: false,
    }));

    const params: PreprocessorPromptParams = {
      schoolLevel: "Terminale",
      studyLevel: "Lycée",
      quizType: "EXAMEN",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 1000,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 40,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result.questionTypes).toHaveLength(10);

    // Compter les types
    const typeCounts = result.questionTypes.reduce(
      (acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Vérifier approximativement les proportions (arrondi)
    expect(typeCounts["MULTIPLE_CHOICE"]).toBeGreaterThanOrEqual(3);
    expect(typeCounts["MULTIPLE_CHOICE"]).toBeLessThanOrEqual(5);
    expect(typeCounts["TRUE_FALSE"]).toBeGreaterThanOrEqual(2);
    expect(typeCounts["TRUE_FALSE"]).toBeLessThanOrEqual(4);
  });

  it("should call validator with correct parameters", async () => {
    const mockResponse = {
      recommendedQuestions: 12,
      questionTypes: {
        multipleChoice: 50,
        trueFalse: 50,
        openEnded: 0,
        matching: 0,
      },
      difficulty: "easy",
      suggestedDuration: 18,
      contentCoverage: "balanced",
      reasoning: "Simple revision",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "REVISION",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 800,
      hasFormulas: false,
      hasDefinitions: true,
      subscriptionLimit: 10,
    };

    await agent.analyzeAndRecommend(params, "user-123");

    expect(quizLimitValidator.validateAndCorrect).toHaveBeenCalledWith(
      expect.objectContaining({
        recommendedQuestionCount: 12,
        difficulty: "easy",
        reasoning: "Simple revision",
      }),
      "user-123",
    );
  });

  it("should handle zero duration (no time limit)", async () => {
    const mockResponse = {
      recommendedQuestions: 5,
      questionTypes: {
        multipleChoice: 100,
        trueFalse: 0,
        openEnded: 0,
        matching: 0,
      },
      difficulty: "easy",
      suggestedDuration: 0, // No time limit
      contentCoverage: "focused",
      reasoning: "Quick quiz",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    mockValidator.validateAndCorrect.mockImplementation(async (output) => ({
      isValid: true,
      correctedOutput: output,
      corrections: [],
      upgradeRequired: false,
    }));

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Quick test",
      sourceTopics: [],
      wordCount: 300,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result.suggestedTimeLimit).toBeNull();
  });

  it("should handle timeout errors from OpenAI", async () => {
    (mockOpenAI.chat.completions.create as jest.Mock).mockRejectedValue(
      new Error("Request timeout"),
    );

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    await expect(agent.analyzeAndRecommend(params, "user-1")).rejects.toThrow();
  });
});

describe("QuizPreprocessorAgent - Edge Cases", () => {
  let agent: QuizPreprocessorAgent;
  let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "sk-test-key";

    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<OpenAI>;

    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI);

    agent = new QuizPreprocessorAgent();

    mockValidator.validateAndCorrect.mockImplementation(async (output) => ({
      isValid: true,
      correctedOutput: output,
      corrections: [],
      upgradeRequired: false,
    }));
  });

  it("should handle 100% of single question type", async () => {
    const mockResponse = {
      recommendedQuestions: 10,
      questionTypes: {
        multipleChoice: 100,
        trueFalse: 0,
        openEnded: 0,
        matching: 0,
      },
      difficulty: "medium",
      suggestedDuration: 15,
      contentCoverage: "focused",
      reasoning: "MC only",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result.questionTypes).toHaveLength(10);
    expect(result.questionTypes.every((t) => t === "MULTIPLE_CHOICE")).toBe(true);
  });

  it("should handle rounding with odd total questions", async () => {
    const mockResponse = {
      recommendedQuestions: 7, // Odd number
      questionTypes: {
        multipleChoice: 50,
        trueFalse: 50,
        openEnded: 0,
        matching: 0,
      },
      difficulty: "medium",
      suggestedDuration: 12,
      contentCoverage: "balanced",
      reasoning: "Test",
    };

    (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockResponse),
          },
        },
      ],
    });

    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: [],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const result = await agent.analyzeAndRecommend(params, "user-1");

    expect(result.questionTypes).toHaveLength(7);
  });
});
