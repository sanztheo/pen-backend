/**
 * 🧪 Integration Helper Tests - PEN-37
 * Tests pour l'intégration du preprocessor dans le flux de génération
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import {
  runPreprocessorForGeneration,
  type PreprocessorIntegrationParams,
} from "../integrationHelper.js";
import { quizPreprocessorAgent } from "../QuizPreprocessorAgent.js";
import { prisma } from "../../../../lib/prisma.js";

// Cast to any for mocking
const mockPrisma = prisma as any;
const mockAgent = quizPreprocessorAgent as any;

describe("runPreprocessorForGeneration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should successfully process pages and return recommendations", async () => {
    // Mock page data
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Introduction to Photosynthesis",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Photosynthesis is the process..." }],
          },
          {
            type: "heading",
            content: [{ text: "Key Concepts" }],
          },
          {
            type: "paragraph",
            content: [{ text: "Chlorophyll absorbs light energy..." }],
          },
        ]),
      },
    ]);

    // Mock user limits
    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    // Mock agent response
    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 8,
      questionTypes: [
        "MULTIPLE_CHOICE",
        "MULTIPLE_CHOICE",
        "TRUE_FALSE",
        "TRUE_FALSE",
        "MULTIPLE_CHOICE",
        "TRUE_FALSE",
        "MULTIPLE_CHOICE",
        "MULTIPLE_CHOICE",
      ],
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Based on content complexity",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      quizType: "REVISION",
      pageProjectIds: ["page-1"],
    };

    const result = await runPreprocessorForGeneration(params);

    expect(result).toBeDefined();
    expect(result.questionCount).toBe(8);
    expect(result.questionTypes).toHaveLength(8);
    expect(result.difficulty).toBe("medium");
    expect(result.timeLimit).toBe(15);
    expect(result.reasoning).toBeTruthy();
    expect(result.correctedByLimits).toBe(false);
  });

  it("should handle workspace selection", async () => {
    // Mock workspace data
    mockPrisma.workspace.findMany.mockResolvedValue([
      {
        id: "ws-1",
        name: "Biology Notes",
        pages: [
          {
            title: "Cell Structure",
            blockNoteContent: JSON.stringify([
              {
                type: "paragraph",
                content: [{ text: "Cells are the basic units of life..." }],
              },
            ]),
          },
        ],
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 10,
      questionTypes: Array(10).fill("MULTIPLE_CHOICE"),
      difficulty: "easy",
      suggestedTimeLimit: 20,
      reasoning: "Workspace content",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "6ème",
      quizType: "ENTRAINEMENT",
      workspaceIds: ["ws-1"],
    };

    const result = await runPreprocessorForGeneration(params);

    expect(result).toBeDefined();
    expect(result.questionCount).toBe(10);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["ws-1"] },
        }),
      }),
    );
  });

  it("should throw error if content is insufficient", async () => {
    // Mock empty or minimal content
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Short",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Too short" }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    await expect(runPreprocessorForGeneration(params)).rejects.toThrow("Contenu insuffisant");
  });

  it("should detect formulas in content", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Math Formulas",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "The quadratic formula is used to..." }],
          },
          {
            type: "latex",
            props: { formula: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" },
          },
          {
            type: "paragraph",
            content: [{ text: "This formula helps solve quadratic equations..." }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 8,
      questionTypes: Array(8).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Math content",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "3ème",
      pageProjectIds: ["page-1"],
    };

    await runPreprocessorForGeneration(params);

    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        hasFormulas: true,
      }),
      "user-1",
    );
  });

  it("should detect definitions from headings", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Definitions",
        blockNoteContent: JSON.stringify([
          {
            type: "heading",
            content: [{ text: "Definition of Photosynthesis" }],
          },
          {
            type: "paragraph",
            content: [{ text: "Photosynthesis is..." }],
          },
          {
            type: "heading",
            content: [{ text: "Definition of Chlorophyll" }],
          },
          {
            type: "paragraph",
            content: [{ text: "Chlorophyll is..." }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 7,
      questionTypes: Array(7).fill("MULTIPLE_CHOICE"),
      difficulty: "easy",
      suggestedTimeLimit: 12,
      reasoning: "Definition-based",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    await runPreprocessorForGeneration(params);

    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        hasDefinitions: true,
      }),
      "user-1",
    );
  });

  it("should extract topics from page titles", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Photosynthesis",
        blockNoteContent: JSON.stringify([
          { type: "paragraph", content: [{ text: "Content..." }] },
        ]),
      },
      {
        id: "page-2",
        title: "Cell Respiration",
        blockNoteContent: JSON.stringify([
          { type: "paragraph", content: [{ text: "More content..." }] },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 10,
      questionTypes: Array(10).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 20,
      reasoning: "Multi-topic",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1", "page-2"],
    };

    await runPreprocessorForGeneration(params);

    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTopics: expect.arrayContaining(["Photosynthesis", "Cell Respiration"]),
      }),
      "user-1",
    );
  });

  it("should respect user subscription limits", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Test Page",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [
              {
                text: "This is a longer piece of content with enough words to generate a quiz...",
              },
            ],
          },
        ]),
      },
    ]);

    // Free user with 10 questions limit
    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-free",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 10,
      questionTypes: Array(10).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Limited by subscription",
      correctedByLimits: true,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-free",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    const result = await runPreprocessorForGeneration(params);

    expect(result.correctedByLimits).toBe(true);
    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionLimit: 10,
      }),
      "user-free",
    );
  });

  it("should use default quiz type if not provided", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Test",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Enough content to generate a quiz from this..." }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 8,
      questionTypes: Array(8).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Default type",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
      // No quizType specified
    };

    await runPreprocessorForGeneration(params);

    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        quizType: "ENTRAINEMENT",
      }),
      "user-1",
    );
  });

  it("should handle null timeLimit", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Test",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Content for quiz generation..." }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 5,
      questionTypes: Array(5).fill("MULTIPLE_CHOICE"),
      difficulty: "easy",
      suggestedTimeLimit: null, // No time limit
      reasoning: "Quick quiz",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    const result = await runPreprocessorForGeneration(params);

    expect(result.timeLimit).toBeUndefined();
  });

  it("should limit workspace pages to 5 per workspace", async () => {
    // Mock workspace with more than 5 pages
    mockPrisma.workspace.findMany.mockResolvedValue([
      {
        id: "ws-1",
        name: "Large Workspace",
        pages: [
          {
            title: "Page 1",
            blockNoteContent: JSON.stringify([
              { type: "paragraph", content: [{ text: "Content 1..." }] },
            ]),
          },
          {
            title: "Page 2",
            blockNoteContent: JSON.stringify([
              { type: "paragraph", content: [{ text: "Content 2..." }] },
            ]),
          },
          {
            title: "Page 3",
            blockNoteContent: JSON.stringify([
              { type: "paragraph", content: [{ text: "Content 3..." }] },
            ]),
          },
          {
            title: "Page 4",
            blockNoteContent: JSON.stringify([
              { type: "paragraph", content: [{ text: "Content 4..." }] },
            ]),
          },
          {
            title: "Page 5",
            blockNoteContent: JSON.stringify([
              { type: "paragraph", content: [{ text: "Content 5..." }] },
            ]),
          },
          // Note: Prisma take: 5 will limit to 5 pages
        ],
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 10,
      questionTypes: Array(10).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 20,
      reasoning: "Workspace content",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      workspaceIds: ["ws-1"],
    };

    await runPreprocessorForGeneration(params);

    expect(prisma.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          pages: expect.objectContaining({
            take: 5,
          }),
        }),
      }),
    );
  });
});

describe("Integration Helper - Edge Cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should handle malformed BlockNote content", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Broken Content",
        blockNoteContent: "not valid json",
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue({
      userId: "user-1",
      questionsPerQuizLimit: 10,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    // Should not crash, but should fail on insufficient content
    await expect(runPreprocessorForGeneration(params)).rejects.toThrow("Contenu insuffisant");
  });

  it("should handle empty pageProjectIds and workspaceIds", async () => {
    const params: PreprocessorIntegrationParams = {
      userId: "user-1",
      schoolLevel: "5ème",
      pageProjectIds: [],
      workspaceIds: [],
    };

    await expect(runPreprocessorForGeneration(params)).rejects.toThrow("Contenu insuffisant");
  });

  it("should handle missing userLimits", async () => {
    mockPrisma.page.findMany.mockResolvedValue([
      {
        id: "page-1",
        title: "Test",
        blockNoteContent: JSON.stringify([
          {
            type: "paragraph",
            content: [{ text: "Sufficient content for quiz generation..." }],
          },
        ]),
      },
    ]);

    mockPrisma.userLimits.findUnique.mockResolvedValue(null);

    mockAgent.analyzeAndRecommend.mockResolvedValue({
      recommendedQuestionCount: 10,
      questionTypes: Array(10).fill("MULTIPLE_CHOICE"),
      difficulty: "medium",
      suggestedTimeLimit: 15,
      reasoning: "Default limits",
      correctedByLimits: false,
    });

    const params: PreprocessorIntegrationParams = {
      userId: "user-new",
      schoolLevel: "5ème",
      pageProjectIds: ["page-1"],
    };

    const result = await runPreprocessorForGeneration(params);

    // Should use default limit of 10
    expect(quizPreprocessorAgent.analyzeAndRecommend).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionLimit: 10,
      }),
      "user-new",
    );
  });
});
