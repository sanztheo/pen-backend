/**
 * 🧪 Prompts Tests - PEN-37
 * Tests unitaires pour les prompts XML du preprocessor
 */

import { describe, expect, it } from "@jest/globals";
import {
  buildPreprocessorPrompt,
  QUIZ_PREPROCESSOR_SYSTEM_PROMPT,
  PREPROCESSOR_MODEL,
  PREPROCESSOR_TEMPERATURE,
  PREPROCESSOR_MAX_TOKENS,
  type PreprocessorPromptParams,
  type PreprocessorAIOutput,
} from "../prompts.js";

describe("QUIZ_PREPROCESSOR_SYSTEM_PROMPT", () => {
  it("should contain required XML structure", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<system>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<role>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<task>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<context>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<instructions>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<rules>");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("<examples>");
  });

  it("should specify JSON-only output format", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("ONLY valid JSON");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("no markdown");
  });

  it("should define all required output fields", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("recommendedQuestions");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("questionTypes");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("difficulty");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("suggestedDuration");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("contentCoverage");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("reasoning");
  });

  it("should include difficulty options", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("easy|medium|hard");
  });

  it("should include content coverage options", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("focused|balanced|comprehensive");
  });

  it("should specify subscription limit constraint", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("subscriptionLimit");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("NEVER exceed subscriptionLimit");
  });

  it("should require question type percentages to sum to 100", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("sum to exactly 100");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("sum=100");
  });

  it("should contain at least 2 examples", () => {
    const exampleMatches = QUIZ_PREPROCESSOR_SYSTEM_PROMPT.match(/<example>/g);
    expect(exampleMatches).not.toBeNull();
    expect(exampleMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("should include all quiz types", () => {
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("ENTRAINEMENT");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("REVISION");
    expect(QUIZ_PREPROCESSOR_SYSTEM_PROMPT).toContain("EXAMEN");
  });
});

describe("buildPreprocessorPrompt", () => {
  it("should generate valid XML prompt structure", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "REVISION",
      sourceSummary: "Introduction to photosynthesis",
      sourceTopics: ["photosynthesis", "chlorophyll"],
      wordCount: 800,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 10,
      userLanguage: "French",
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<quiz_request>");
    expect(prompt).toContain("<user_context>");
    expect(prompt).toContain("<source_analysis>");
    expect(prompt).toContain("<constraints>");
    expect(prompt).toContain("</quiz_request>");
  });

  it("should include all parameters in prompt", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "Terminale",
      studyLevel: "Lycée",
      quizType: "EXAMEN",
      sourceSummary: "Quantum mechanics overview",
      sourceTopics: ["quantum physics", "wave-particle duality"],
      wordCount: 2500,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 25,
      userLanguage: "French",
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<school_level>Terminale</school_level>");
    expect(prompt).toContain("<study_level>Lycée</study_level>");
    expect(prompt).toContain("<quiz_type>EXAMEN</quiz_type>");
    expect(prompt).toContain("<summary>Quantum mechanics overview</summary>");
    expect(prompt).toContain("quantum physics");
    expect(prompt).toContain("wave-particle duality");
    expect(prompt).toContain("<word_count>2500</word_count>");
    expect(prompt).toContain("<has_formulas>true</has_formulas>");
    expect(prompt).toContain("<has_definitions>true</has_definitions>");
    expect(prompt).toContain("<max_questions>25</max_questions>");
    expect(prompt).toContain("<preferred_language>French</preferred_language>");
  });

  it("should handle empty topics list", () => {
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

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<topics>");
    expect(prompt).toContain("No specific topics extracted");
    expect(prompt).toContain("</topics>");
  });

  it("should format topics as list items", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "3ème",
      studyLevel: "College",
      quizType: "REVISION",
      sourceSummary: "Multiple topics",
      sourceTopics: ["Topic A", "Topic B", "Topic C"],
      wordCount: 1000,
      hasFormulas: false,
      hasDefinitions: true,
      subscriptionLimit: 15,
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("- Topic A");
    expect(prompt).toContain("- Topic B");
    expect(prompt).toContain("- Topic C");
  });

  it("should default to French if language not provided", () => {
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

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<preferred_language>French</preferred_language>");
  });

  it("should handle boolean flags correctly", () => {
    const paramsWithFormulas: PreprocessorPromptParams = {
      schoolLevel: "1ère",
      studyLevel: "Lycée",
      quizType: "REVISION",
      sourceSummary: "Math content",
      sourceTopics: ["algebra"],
      wordCount: 1500,
      hasFormulas: true,
      hasDefinitions: false,
      subscriptionLimit: 20,
    };

    const promptWithFormulas = buildPreprocessorPrompt(paramsWithFormulas);
    expect(promptWithFormulas).toContain("<has_formulas>true</has_formulas>");
    expect(promptWithFormulas).toContain("<has_definitions>false</has_definitions>");

    const paramsNoFormulas: PreprocessorPromptParams = {
      ...paramsWithFormulas,
      hasFormulas: false,
      hasDefinitions: true,
    };

    const promptNoFormulas = buildPreprocessorPrompt(paramsNoFormulas);
    expect(promptNoFormulas).toContain("<has_formulas>false</has_formulas>");
    expect(promptNoFormulas).toContain("<has_definitions>true</has_definitions>");
  });

  it("should handle all quiz types", () => {
    const quizTypes: Array<"ENTRAINEMENT" | "REVISION" | "EXAMEN"> = [
      "ENTRAINEMENT",
      "REVISION",
      "EXAMEN",
    ];

    for (const quizType of quizTypes) {
      const params: PreprocessorPromptParams = {
        schoolLevel: "5ème",
        studyLevel: "College",
        quizType,
        sourceSummary: "Test",
        sourceTopics: [],
        wordCount: 500,
        hasFormulas: false,
        hasDefinitions: false,
        subscriptionLimit: 10,
      };

      const prompt = buildPreprocessorPrompt(params);
      expect(prompt).toContain(`<quiz_type>${quizType}</quiz_type>`);
    }
  });

  it("should end with instruction to return JSON", () => {
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

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("Return the optimal quiz parameters as JSON");
  });
});

describe("Model configuration constants", () => {
  it("should reference the centralized PREPROCESSOR model", () => {
    expect(PREPROCESSOR_MODEL).toBeDefined();
    expect(typeof PREPROCESSOR_MODEL).toBe("string");
  });

  it("should use low temperature for consistent output", () => {
    expect(PREPROCESSOR_TEMPERATURE).toBe(0.3);
    expect(PREPROCESSOR_TEMPERATURE).toBeLessThanOrEqual(0.5);
  });

  it("should have reasonable max tokens", () => {
    expect(PREPROCESSOR_MAX_TOKENS).toBe(800);
    expect(PREPROCESSOR_MAX_TOKENS).toBeGreaterThanOrEqual(500);
    expect(PREPROCESSOR_MAX_TOKENS).toBeLessThanOrEqual(1500);
  });
});

describe("PreprocessorAIOutput type validation", () => {
  it("should match expected structure in examples", () => {
    // Cette fonction simule la validation de structure
    const validateOutput = (obj: unknown): obj is PreprocessorAIOutput => {
      if (!obj || typeof obj !== "object") return false;

      const o = obj as Record<string, unknown>;

      if (typeof o.recommendedQuestions !== "number") return false;
      if (typeof o.suggestedDuration !== "number") return false;
      if (typeof o.reasoning !== "string") return false;

      if (!["easy", "medium", "hard"].includes(o.difficulty as string)) return false;

      if (!["focused", "balanced", "comprehensive"].includes(o.contentCoverage as string))
        return false;

      if (!o.questionTypes || typeof o.questionTypes !== "object") return false;

      const types = o.questionTypes as Record<string, unknown>;
      if (
        typeof types.multipleChoice !== "number" ||
        typeof types.trueFalse !== "number" ||
        typeof types.openEnded !== "number" ||
        typeof types.matching !== "number"
      )
        return false;

      const sum = types.multipleChoice + types.trueFalse + types.openEnded + types.matching;
      if (sum !== 100) return false;

      return true;
    };

    // Valid example
    const validOutput = {
      recommendedQuestions: 12,
      questionTypes: {
        multipleChoice: 40,
        trueFalse: 30,
        openEnded: 10,
        matching: 20,
      },
      difficulty: "easy",
      suggestedDuration: 15,
      contentCoverage: "balanced",
      reasoning: "Test reasoning",
    };

    expect(validateOutput(validOutput)).toBe(true);

    // Invalid: percentages don't sum to 100
    const invalidSum = {
      ...validOutput,
      questionTypes: {
        multipleChoice: 40,
        trueFalse: 30,
        openEnded: 10,
        matching: 15, // Sum = 95
      },
    };

    expect(validateOutput(invalidSum)).toBe(false);

    // Invalid: wrong difficulty
    const invalidDifficulty = {
      ...validOutput,
      difficulty: "impossible",
    };

    expect(validateOutput(invalidDifficulty)).toBe(false);
  });
});

describe("Prompt generation edge cases", () => {
  it("should handle very long summaries", () => {
    const longSummary = "A".repeat(5000);
    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: longSummary,
      sourceTopics: [],
      wordCount: 10000,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain(longSummary);
    expect(prompt.length).toBeGreaterThan(5000);
  });

  it("should handle special characters in topics", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "Test",
      sourceTopics: ["L'équation", "Les forêts", "À propos"],
      wordCount: 500,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("- L'équation");
    expect(prompt).toContain("- Les forêts");
    expect(prompt).toContain("- À propos");
  });

  it("should handle zero word count", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "5ème",
      studyLevel: "College",
      quizType: "ENTRAINEMENT",
      sourceSummary: "",
      sourceTopics: [],
      wordCount: 0,
      hasFormulas: false,
      hasDefinitions: false,
      subscriptionLimit: 10,
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<word_count>0</word_count>");
  });

  it("should handle maximum subscription limit", () => {
    const params: PreprocessorPromptParams = {
      schoolLevel: "Licence 1",
      studyLevel: "Université",
      quizType: "EXAMEN",
      sourceSummary: "Advanced content",
      sourceTopics: [],
      wordCount: 5000,
      hasFormulas: true,
      hasDefinitions: true,
      subscriptionLimit: 40, // Premium max
    };

    const prompt = buildPreprocessorPrompt(params);

    expect(prompt).toContain("<max_questions>40</max_questions>");
  });
});
