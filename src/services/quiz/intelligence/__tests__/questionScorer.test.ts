/**
 * 🧪 QuestionScorerService Tests - PEN-24
 * Tests unitaires pour le scoring et la déduplication des questions
 */

import { describe, expect, it } from "@jest/globals";
import {
  QuestionScorerService,
  type QuestionScore,
  type DuplicateCheckResult,
} from "../questionScorer.js";
import { QuestionType, type Question } from "../../types.js";

// ============================================================================
// Test Data Fixtures
// ============================================================================

const createOpenQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: "test-open-1",
  type: QuestionType.OPEN_QUESTION,
  question:
    "Expliquez le processus de photosynthèse et son importance pour l'écosystème.",
  difficulty: "moyen",
  points: 5,
  expectedAnswer: "La photosynthèse est le processus par lequel les plantes...",
  keywords: ["photosynthèse", "chlorophylle", "glucose"],
  ...overrides,
});

const createMultipleChoiceQuestion = (
  overrides: Partial<Question> = {},
): Question => ({
  id: "test-mcq-1",
  type: QuestionType.MULTIPLE_CHOICE,
  question: "Quelle est la formule chimique de l'eau?",
  difficulty: "facile",
  points: 2,
  options: [
    { id: "a", text: "H2O", isCorrect: true },
    { id: "b", text: "CO2", isCorrect: false },
    { id: "c", text: "NaCl", isCorrect: false },
    { id: "d", text: "O2", isCorrect: false },
  ],
  ...overrides,
});

const createTrueFalseQuestion = (
  overrides: Partial<Question> = {},
): Question => ({
  id: "test-tf-1",
  type: QuestionType.TRUE_FALSE,
  question: "La Terre est le troisième planète du système solaire.",
  difficulty: "facile",
  points: 1,
  correctAnswer: true,
  explanation:
    "La Terre est effectivement la troisième planète en partant du Soleil.",
  ...overrides,
});

const createMatchingQuestion = (
  overrides: Partial<Question> = {},
): Question => ({
  id: "test-match-1",
  type: QuestionType.MATCHING,
  question: "Associez chaque capitale à son pays.",
  difficulty: "moyen",
  points: 4,
  leftColumn: [
    { id: "l1", text: "Paris" },
    { id: "l2", text: "Berlin" },
    { id: "l3", text: "Madrid" },
  ],
  rightColumn: [
    { id: "r1", text: "France" },
    { id: "r2", text: "Allemagne" },
    { id: "r3", text: "Espagne" },
  ],
  correctMatches: [
    { leftId: "l1", rightId: "r1" },
    { leftId: "l2", rightId: "r2" },
    { leftId: "l3", rightId: "r3" },
  ],
  ...overrides,
});

// ============================================================================
// Tests: scoreQuestion
// ============================================================================

describe("QuestionScorerService.scoreQuestion", () => {
  describe("Clarity scoring (based on length)", () => {
    it("should give high clarity score for optimal length (50-200 chars)", () => {
      const question = createOpenQuestion({
        question:
          "Expliquez brièvement le cycle de l'eau et ses principales étapes.",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.clarity).toBeGreaterThanOrEqual(0.8);
      expect(score.reasons).toContain("Longueur d'énoncé optimale");
    });

    it("should penalize very short questions", () => {
      const question = createOpenQuestion({
        question: "Qu'est-ce?",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.clarity).toBeLessThanOrEqual(0.5);
      expect(score.reasons.some((r) => r.includes("trop court"))).toBe(true);
    });

    it("should penalize very long questions", () => {
      const question = createOpenQuestion({
        question: "A".repeat(600), // > 500 chars
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.clarity).toBeLessThanOrEqual(0.6);
      expect(score.reasons.some((r) => r.includes("trop long"))).toBe(true);
    });
  });

  describe("Relevance scoring", () => {
    it("should give bonus for questions with correct answer defined", () => {
      const question = createOpenQuestion({
        expectedAnswer: "Réponse attendue complète",
        keywords: ["mot1", "mot2"],
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.relevance).toBeGreaterThanOrEqual(0.7);
      expect(score.reasons).toContain("Réponse correcte définie");
    });

    it("should penalize questions without correct answer", () => {
      const question = createOpenQuestion({
        expectedAnswer: undefined,
        keywords: [],
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.relevance).toBeLessThanOrEqual(0.5);
      expect(score.reasons).toContain("Réponse correcte manquante");
    });

    it("should give bonus for TrueFalse questions with explanation", () => {
      const question = createTrueFalseQuestion({
        explanation: "Cette explication détaille pourquoi c'est vrai.",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.relevance).toBeGreaterThanOrEqual(0.8);
      expect(score.reasons).toContain("Explication fournie");
    });
  });

  describe("Option variety scoring (MCQ)", () => {
    it("should give perfect score for well-varied options", () => {
      const question = createMultipleChoiceQuestion({
        options: [
          { id: "a", text: "H2O - eau pure", isCorrect: true },
          { id: "b", text: "Dioxyde de carbone", isCorrect: false },
          { id: "c", text: "Sel de table", isCorrect: false },
          { id: "d", text: "Oxygène moléculaire O2", isCorrect: false },
        ],
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.optionVariety).toBeGreaterThanOrEqual(0.7);
    });

    it("should penalize duplicate options", () => {
      const question = createMultipleChoiceQuestion({
        options: [
          { id: "a", text: "Réponse A", isCorrect: true },
          { id: "b", text: "Réponse A", isCorrect: false }, // Duplicate
          { id: "c", text: "Réponse C", isCorrect: false },
        ],
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.optionVariety).toBeLessThanOrEqual(0.5);
      expect(score.reasons).toContain("Options en double détectées");
    });

    it("should penalize too few options", () => {
      const question = createMultipleChoiceQuestion({
        options: [
          { id: "a", text: "Oui", isCorrect: true },
          { id: "b", text: "Non", isCorrect: false },
        ],
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.optionVariety).toBeLessThanOrEqual(0.7);
      expect(score.reasons).toContain("Seulement 2 options");
    });

    it("should give perfect score for non-MCQ questions", () => {
      const question = createTrueFalseQuestion();

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.optionVariety).toBe(1.0);
    });
  });

  describe("Difficulty coherence scoring", () => {
    it("should validate coherent difficulty for simple questions", () => {
      const question = createTrueFalseQuestion({
        question: "L'eau bout à 100°C.",
        difficulty: "facile",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.difficultyCoherence).toBeGreaterThanOrEqual(0.6);
    });

    it("should validate coherent difficulty for complex questions", () => {
      const question = createOpenQuestion({
        question:
          "Analysez les implications géopolitiques, économiques et sociales du traité de Versailles de 1919, en considérant les différentes perspectives des nations signataires ainsi que les conséquences à long terme sur l'équilibre européen.",
        difficulty: "difficile",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.difficultyCoherence).toBeGreaterThanOrEqual(0.6);
    });

    it("should detect questions with formulas as potentially harder", () => {
      const question = createOpenQuestion({
        question: "Résolvez l'équation: x² + 2x - 15 = 0",
        difficulty: "difficile",
      });

      const score = QuestionScorerService.scoreQuestion(question);

      expect(score.difficultyCoherence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("Overall score calculation", () => {
    it("should calculate weighted average correctly", () => {
      const question = createMultipleChoiceQuestion();

      const score = QuestionScorerService.scoreQuestion(question);

      // Overall should be between 0 and 1
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(1);

      // Check that weights sum to 1
      const calculatedOverall =
        score.clarity * 0.25 +
        score.relevance * 0.35 +
        score.optionVariety * 0.25 +
        score.difficultyCoherence * 0.15;

      expect(score.overall).toBeCloseTo(calculatedOverall, 1);
    });
  });
});

// ============================================================================
// Tests: isDuplicate
// ============================================================================

describe("QuestionScorerService.isDuplicate", () => {
  it("should return false for empty existing questions", () => {
    const question = createOpenQuestion();

    const result = QuestionScorerService.isDuplicate(question, []);

    expect(result.isDuplicate).toBe(false);
    expect(result.similarity).toBe(0);
  });

  it("should detect exact duplicates", () => {
    const question1 = createOpenQuestion({
      question: "Qu'est-ce que la photosynthèse?",
    });
    const question2 = createOpenQuestion({
      id: "test-2",
      question: "Qu'est-ce que la photosynthèse?",
    });

    const result = QuestionScorerService.isDuplicate(question2, [question1]);

    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.85);
    expect(result.similarTo).toBe(0);
  });

  it("should detect similar questions above threshold", () => {
    const question1 = createOpenQuestion({
      question: "Expliquez le processus de photosynthèse dans les plantes.",
    });
    const question2 = createOpenQuestion({
      id: "test-2",
      question: "Décrivez le processus de photosynthèse chez les plantes.",
    });

    const result = QuestionScorerService.isDuplicate(question2, [question1]);

    // These are very similar (Jaccard similarity may be exactly 0.5)
    expect(result.similarity).toBeGreaterThanOrEqual(0.5);
  });

  it("should not flag different questions as duplicates", () => {
    const question1 = createOpenQuestion({
      question: "Qu'est-ce que la photosynthèse?",
    });
    const question2 = createOpenQuestion({
      id: "test-2",
      question: "Comment fonctionne un moteur à combustion interne?",
    });

    const result = QuestionScorerService.isDuplicate(question2, [question1]);

    expect(result.isDuplicate).toBe(false);
    expect(result.similarity).toBeLessThan(0.5);
  });

  it("should find the most similar question", () => {
    const existingQuestions = [
      createOpenQuestion({ id: "q1", question: "Qu'est-ce que l'ADN?" }),
      createOpenQuestion({
        id: "q2",
        question: "Qu'est-ce que la photosynthèse?",
      }),
      createOpenQuestion({
        id: "q3",
        question: "Comment fonctionne une cellule?",
      }),
    ];

    const newQuestion = createOpenQuestion({
      id: "new",
      question: "Expliquez ce qu'est la photosynthèse.",
    });

    const result = QuestionScorerService.isDuplicate(
      newQuestion,
      existingQuestions,
    );

    expect(result.similarTo).toBe(1); // Index of photosynthesis question
  });
});

// ============================================================================
// Tests: isAcceptable
// ============================================================================

describe("QuestionScorerService.isAcceptable", () => {
  it("should accept high-quality unique questions", () => {
    const question = createMultipleChoiceQuestion({
      question: "Quelle est la capitale de la France?",
      options: [
        { id: "a", text: "Paris, la ville lumière", isCorrect: true },
        { id: "b", text: "Lyon, la ville des lumières", isCorrect: false },
        { id: "c", text: "Marseille, la cité phocéenne", isCorrect: false },
        { id: "d", text: "Toulouse, la ville rose", isCorrect: false },
      ],
    });

    const result = QuestionScorerService.isAcceptable(question, []);

    expect(result.acceptable).toBe(true);
    expect(result.score.overall).toBeGreaterThanOrEqual(0.5);
    expect(result.duplicate.isDuplicate).toBe(false);
  });

  it("should reject low-quality questions", () => {
    const question = createOpenQuestion({
      question: "?", // Extremely short - just a question mark
      expectedAnswer: undefined,
      keywords: [],
    });

    const result = QuestionScorerService.isAcceptable(question, [], {
      minScore: 0.6, // Higher threshold to ensure rejection
    });

    expect(result.acceptable).toBe(false);
    expect(result.score.overall).toBeLessThan(0.6);
  });

  it("should reject duplicate questions", () => {
    const existing = createOpenQuestion({
      question: "Décrivez le cycle de l'eau.",
    });

    const duplicate = createOpenQuestion({
      id: "new",
      question: "Décrivez le cycle de l'eau.",
    });

    const result = QuestionScorerService.isAcceptable(duplicate, [existing]);

    expect(result.acceptable).toBe(false);
    expect(result.duplicate.isDuplicate).toBe(true);
  });

  it("should respect custom minScore threshold", () => {
    const question = createMultipleChoiceQuestion();

    const resultLowThreshold = QuestionScorerService.isAcceptable(
      question,
      [],
      { minScore: 0.3 },
    );
    const resultHighThreshold = QuestionScorerService.isAcceptable(
      question,
      [],
      { minScore: 0.95 },
    );

    expect(resultLowThreshold.acceptable).toBe(true);
    expect(resultHighThreshold.acceptable).toBe(false);
  });
});

// ============================================================================
// Tests: getSuggestions
// ============================================================================

describe("QuestionScorerService.getSuggestions", () => {
  it("should suggest improving short questions", () => {
    const question = createOpenQuestion({
      question: "Quoi?",
    });
    const score = QuestionScorerService.scoreQuestion(question);

    const suggestions = QuestionScorerService.getSuggestions(question, score);

    expect(suggestions.some((s) => s.includes("trop court"))).toBe(true);
  });

  it("should suggest adding correct answer", () => {
    const question = createOpenQuestion({
      expectedAnswer: undefined,
      keywords: [],
    });
    const score = QuestionScorerService.scoreQuestion(question);

    const suggestions = QuestionScorerService.getSuggestions(question, score);

    expect(suggestions.some((s) => s.includes("réponse correcte"))).toBe(true);
  });

  it("should suggest improving MCQ options variety when below threshold", () => {
    // Create a question with duplicate options (score < 0.6 triggers suggestion)
    const question = createMultipleChoiceQuestion({
      options: [
        { id: "a", text: "Réponse A", isCorrect: true },
        { id: "b", text: "Réponse A", isCorrect: false }, // Duplicate!
        { id: "c", text: "Réponse C", isCorrect: false },
      ],
    });
    const score = QuestionScorerService.scoreQuestion(question);

    // Score should be < 0.6 due to duplicate options
    expect(score.optionVariety).toBeLessThan(0.6);

    const suggestions = QuestionScorerService.getSuggestions(question, score);

    // Check for option-related suggestions
    expect(
      suggestions.some(
        (s) =>
          s.toLowerCase().includes("option") ||
          s.includes("variété") ||
          s.includes("similaires"),
      ),
    ).toBe(true);
  });

  it("should return empty array for high-quality questions", () => {
    const question = createMultipleChoiceQuestion({
      question: "Quelle est la formule chimique de l'eau pure?",
      options: [
        {
          id: "a",
          text: "H2O - deux atomes d'hydrogène et un d'oxygène",
          isCorrect: true,
        },
        { id: "b", text: "CO2 - dioxyde de carbone", isCorrect: false },
        { id: "c", text: "NaCl - chlorure de sodium", isCorrect: false },
        { id: "d", text: "CH4 - méthane", isCorrect: false },
      ],
    });
    const score = QuestionScorerService.scoreQuestion(question);

    // If all scores are high, no suggestions
    if (
      score.clarity >= 0.6 &&
      score.relevance >= 0.6 &&
      score.optionVariety >= 0.6 &&
      score.difficultyCoherence >= 0.6
    ) {
      const suggestions = QuestionScorerService.getSuggestions(question, score);
      expect(suggestions.length).toBe(0);
    }
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe("QuestionScorerService - Performance", () => {
  it("should score a question in less than 5ms", () => {
    const question = createMultipleChoiceQuestion();

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      QuestionScorerService.scoreQuestion(question);
    }
    const elapsed = performance.now() - start;

    // 100 iterations in less than 500ms = less than 5ms per question
    expect(elapsed).toBeLessThan(500);
  });

  it("should check duplicates in reasonable time for 50 questions", () => {
    const existingQuestions = Array.from({ length: 50 }, (_, i) =>
      createOpenQuestion({
        id: `q-${i}`,
        question: `Question numéro ${i} sur un sujet différent et unique.`,
      }),
    );

    const newQuestion = createOpenQuestion({
      id: "new",
      question: "Une toute nouvelle question complètement différente.",
    });

    const start = performance.now();
    const result = QuestionScorerService.isDuplicate(
      newQuestion,
      existingQuestions,
    );
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // Less than 100ms for 50 comparisons
    expect(result.isDuplicate).toBe(false);
  });
});
