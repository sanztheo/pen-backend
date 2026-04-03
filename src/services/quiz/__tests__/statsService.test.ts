/**
 * Unit tests for StatsService pure helper functions
 * Tests: calculateStreaks, calculateTrend, analyzeDifficultyGroup, calculateAverageTime, getStartDate
 */

import { describe, expect, it } from "@jest/globals";
import { StatsService, getStartDate, type QuizWithResult } from "../statsService.js";

// ============================================================================
// Test Data Factory
// ============================================================================

function createQuiz(overrides: Partial<QuizWithResult> = {}): QuizWithResult {
  const defaults: QuizWithResult = {
    id: "quiz-1",
    title: "Test Quiz",
    questions: [],
    difficulty: "moyen",
    schoolLevel: "terminale",
    selectedSpecialties: [],
    higherEdField: null,
    timeSpent: 300,
    isCompleted: true,
    completedAt: new Date(),
    createdAt: new Date(),
    result: { percentage: 75, detailedScoring: [] },
  };
  // Spread preserves explicit null values (unlike ??)
  return { ...defaults, ...overrides };
}

/** Create a Date for N days ago from today */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d;
}

// ============================================================================
// getStartDate
// ============================================================================

describe("getStartDate", () => {
  it("returns a date 7 days ago for 'week'", () => {
    const result = getStartDate("week");
    const expected = new Date();
    expected.setDate(expected.getDate() - 7);
    // Allow 1 second tolerance
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("returns a date 1 month ago for 'month'", () => {
    const result = getStartDate("month");
    const expected = new Date();
    expected.setMonth(expected.getMonth() - 1);
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it("returns a date 1 year ago for 'year'", () => {
    const result = getStartDate("year");
    const expected = new Date();
    expected.setFullYear(expected.getFullYear() - 1);
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });
});

// ============================================================================
// calculateStreaks
// ============================================================================

describe("StatsService.calculateStreaks", () => {
  it("returns 0/0 for empty array", () => {
    const result = StatsService.calculateStreaks([]);
    expect(result).toEqual({ currentStreak: 0, longestStreak: 0 });
  });

  it("returns currentStreak=1 when only today has a quiz", () => {
    const quizzes = [createQuiz({ completedAt: daysAgo(0) })];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it("counts consecutive days including today", () => {
    const quizzes = [
      createQuiz({ id: "q1", completedAt: daysAgo(0) }),
      createQuiz({ id: "q2", completedAt: daysAgo(1) }),
      createQuiz({ id: "q3", completedAt: daysAgo(2) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it("accepts yesterday as start of current streak", () => {
    const quizzes = [
      createQuiz({ id: "q1", completedAt: daysAgo(1) }),
      createQuiz({ id: "q2", completedAt: daysAgo(2) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(2);
  });

  // NOTE: If the most recent quiz is older than yesterday, currentStreak resets to 0
  it("returns currentStreak=0 when most recent quiz is >1 day ago", () => {
    const quizzes = [
      createQuiz({ id: "q1", completedAt: daysAgo(3) }),
      createQuiz({ id: "q2", completedAt: daysAgo(4) }),
      createQuiz({ id: "q3", completedAt: daysAgo(5) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(0);
    // longestStreak should still reflect the historical consecutive days
    expect(result.longestStreak).toBe(3);
  });

  it("streak resets on gap in days", () => {
    const quizzes = [
      createQuiz({ id: "q1", completedAt: daysAgo(0) }),
      createQuiz({ id: "q2", completedAt: daysAgo(1) }),
      // gap at daysAgo(2)
      createQuiz({ id: "q3", completedAt: daysAgo(3) }),
      createQuiz({ id: "q4", completedAt: daysAgo(4) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(2);
  });

  it("deduplicates multiple quizzes on the same day", () => {
    const today = daysAgo(0);
    const quizzes = [
      createQuiz({ id: "q1", completedAt: today }),
      createQuiz({ id: "q2", completedAt: today }),
      createQuiz({ id: "q3", completedAt: daysAgo(1) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(2);
  });

  it("uses createdAt when completedAt is null", () => {
    const quizzes = [
      createQuiz({ id: "q1", completedAt: null, createdAt: daysAgo(0) }),
      createQuiz({ id: "q2", completedAt: null, createdAt: daysAgo(1) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(2);
  });

  it("longestStreak tracks historical max even when current streak is shorter", () => {
    const quizzes = [
      // Current streak: today only
      createQuiz({ id: "q1", completedAt: daysAgo(0) }),
      // Gap at daysAgo(1)
      // Historical streak: 4 days
      createQuiz({ id: "q2", completedAt: daysAgo(2) }),
      createQuiz({ id: "q3", completedAt: daysAgo(3) }),
      createQuiz({ id: "q4", completedAt: daysAgo(4) }),
      createQuiz({ id: "q5", completedAt: daysAgo(5) }),
    ];
    const result = StatsService.calculateStreaks(quizzes);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(4);
  });
});

// ============================================================================
// calculateTrend
// ============================================================================

describe("StatsService.calculateTrend", () => {
  it("returns 'stable' for empty array", () => {
    expect(StatsService.calculateTrend([])).toBe("stable");
  });

  it("returns 'stable' for single quiz", () => {
    const quizzes = [createQuiz({ result: { percentage: 80, detailedScoring: [] } })];
    expect(StatsService.calculateTrend(quizzes)).toBe("stable");
  });

  it("returns 'stable' for two quizzes (requires >= 3)", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 50, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 90, detailedScoring: [] } }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("stable");
  });

  it("returns 'improving' when scores increase over time", () => {
    // Note: quizzes are ordered desc (most recent first), so index 0 = most recent
    // Scores at indices [0,1,2,3,4] map to x=[0,1,2,3,4]
    // For positive slope, later indices should have higher scores
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 40, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 50, detailedScoring: [] } }),
      createQuiz({ id: "q3", result: { percentage: 60, detailedScoring: [] } }),
      createQuiz({ id: "q4", result: { percentage: 80, detailedScoring: [] } }),
      createQuiz({ id: "q5", result: { percentage: 95, detailedScoring: [] } }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("improving");
  });

  it("returns 'declining' when scores decrease over time", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 95, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 80, detailedScoring: [] } }),
      createQuiz({ id: "q3", result: { percentage: 60, detailedScoring: [] } }),
      createQuiz({ id: "q4", result: { percentage: 50, detailedScoring: [] } }),
      createQuiz({ id: "q5", result: { percentage: 40, detailedScoring: [] } }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("declining");
  });

  it("returns 'stable' when scores are roughly equal", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 70, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 71, detailedScoring: [] } }),
      createQuiz({ id: "q3", result: { percentage: 70, detailedScoring: [] } }),
      createQuiz({ id: "q4", result: { percentage: 71, detailedScoring: [] } }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("stable");
  });

  it("only considers first 5 quizzes even if more are provided", () => {
    const quizzes = [
      // First 5 (improving trend)
      createQuiz({ id: "q1", result: { percentage: 40, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 50, detailedScoring: [] } }),
      createQuiz({ id: "q3", result: { percentage: 65, detailedScoring: [] } }),
      createQuiz({ id: "q4", result: { percentage: 80, detailedScoring: [] } }),
      createQuiz({ id: "q5", result: { percentage: 95, detailedScoring: [] } }),
      // These should be ignored
      createQuiz({ id: "q6", result: { percentage: 10, detailedScoring: [] } }),
      createQuiz({ id: "q7", result: { percentage: 5, detailedScoring: [] } }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("improving");
  });

  it("filters out quizzes with 0 percentage but guard checks quizzes.length not scores.length", () => {
    // 4 quizzes passes the length >= 3 guard, but only [70, 72] remain after filtering 0s
    // Linear regression on [70, 72] (n=2): slope = 2 > 0.5 → "improving"
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 70, detailedScoring: [] } }),
      createQuiz({ id: "q2", result: { percentage: 0, detailedScoring: [] } }),
      createQuiz({ id: "q3", result: { percentage: 72, detailedScoring: [] } }),
      createQuiz({ id: "q4", result: null }),
    ];
    expect(StatsService.calculateTrend(quizzes)).toBe("improving");
  });
});

// ============================================================================
// analyzeDifficultyGroup
// ============================================================================

describe("StatsService.analyzeDifficultyGroup", () => {
  it("returns zeroes for empty array", () => {
    const result = StatsService.analyzeDifficultyGroup([]);
    expect(result).toEqual({ averageScore: 0, count: 0, averageTime: 0 });
  });

  it("calculates correct averageScore, count, and averageTime", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 80, detailedScoring: [] }, timeSpent: 600 }),
      createQuiz({ id: "q2", result: { percentage: 60, detailedScoring: [] }, timeSpent: 300 }),
    ];
    const result = StatsService.analyzeDifficultyGroup(quizzes);
    expect(result.count).toBe(2);
    expect(result.averageScore).toBe(70); // (80 + 60) / 2
    expect(result.averageTime).toBe(8); // (600 + 300) / 2 / 60 = 7.5, rounded to 8
  });

  it("excludes scores of 0 from average calculation", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 90, detailedScoring: [] }, timeSpent: 120 }),
      createQuiz({ id: "q2", result: null, timeSpent: 60 }),
    ];
    const result = StatsService.analyzeDifficultyGroup(quizzes);
    expect(result.count).toBe(2); // count includes all quizzes
    expect(result.averageScore).toBe(90); // only the non-zero score
  });

  it("handles quizzes with null timeSpent", () => {
    const quizzes = [
      createQuiz({ id: "q1", result: { percentage: 50, detailedScoring: [] }, timeSpent: null }),
      createQuiz({ id: "q2", result: { percentage: 50, detailedScoring: [] }, timeSpent: 120 }),
    ];
    const result = StatsService.analyzeDifficultyGroup(quizzes);
    expect(result.averageTime).toBe(1); // (0 + 120) / 2 / 60 = 1
  });
});

// ============================================================================
// calculateAverageTime
// ============================================================================

describe("StatsService.calculateAverageTime", () => {
  it("returns 0 for empty array", () => {
    expect(StatsService.calculateAverageTime([])).toBe(0);
  });

  it("calculates average timeSpent in seconds", () => {
    const quizzes = [
      createQuiz({ id: "q1", timeSpent: 100 }),
      createQuiz({ id: "q2", timeSpent: 200 }),
      createQuiz({ id: "q3", timeSpent: 300 }),
    ];
    expect(StatsService.calculateAverageTime(quizzes)).toBe(200);
  });

  it("treats null timeSpent as 0", () => {
    const quizzes = [
      createQuiz({ id: "q1", timeSpent: null }),
      createQuiz({ id: "q2", timeSpent: 100 }),
    ];
    expect(StatsService.calculateAverageTime(quizzes)).toBe(50); // (0 + 100) / 2
  });

  it("returns 0 when all timeSpent are null", () => {
    const quizzes = [
      createQuiz({ id: "q1", timeSpent: null }),
      createQuiz({ id: "q2", timeSpent: null }),
    ];
    expect(StatsService.calculateAverageTime(quizzes)).toBe(0);
  });

  it("handles single quiz", () => {
    const quizzes = [createQuiz({ timeSpent: 420 })];
    expect(StatsService.calculateAverageTime(quizzes)).toBe(420);
  });
});
