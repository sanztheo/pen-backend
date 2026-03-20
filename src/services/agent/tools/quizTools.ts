import { tool } from "ai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { logger } from "../../../utils/logger.js";

interface QuizToolsContext {
  userId: string;
  workspaceId: string;
}

const PERIOD_DAYS: Record<string, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export function createQuizTools(ctx: QuizToolsContext) {
  return {
    getQuizStats: tool({
      description: `Retrieves the user's quiz performance statistics including average score, total quizzes taken, current streak, strengths and weaknesses by subject, and recent progression trend. Use when the user asks about their progress, performance, or study recommendations.`,
      inputSchema: z.object({
        period: z
          .enum(["week", "month", "year"])
          .optional()
          .default("month")
          .describe("Time period for statistics"),
      }),
      execute: async ({ period }) => {
        logger.log(`[TOOL:getQuizStats] userId=${ctx.userId}, period=${period}`);

        try {
          const since = new Date();
          since.setDate(since.getDate() - PERIOD_DAYS[period]);

          // Aggregate stats for the period
          const stats = await prisma.quiz.aggregate({
            where: {
              userId: ctx.userId,
              isCompleted: true,
              completedAt: { gte: since },
            },
            _count: { id: true },
            _avg: { timeSpent: true },
          });

          // Average score from QuizResult
          const scoreStats = await prisma.quizResult.aggregate({
            where: {
              quiz: {
                userId: ctx.userId,
                isCompleted: true,
                completedAt: { gte: since },
              },
            },
            _avg: { percentage: true },
            _min: { percentage: true },
            _max: { percentage: true },
          });

          // Subject breakdown — group by title (subject proxy)
          const recentQuizzes = await prisma.quiz.findMany({
            where: {
              userId: ctx.userId,
              isCompleted: true,
              completedAt: { gte: since },
            },
            select: {
              title: true,
              subjects: true,
              completedAt: true,
              result: {
                select: { percentage: true, strengths: true, weaknesses: true },
              },
            },
            orderBy: { completedAt: "desc" },
            take: 50,
          });

          // Build subject breakdown from subjects field or title
          const subjectMap = new Map<string, { scores: number[]; count: number }>();

          for (const quiz of recentQuizzes) {
            const subjects = extractSubjects(quiz.subjects, quiz.title);
            const score = quiz.result?.percentage ?? 0;

            for (const subject of subjects) {
              const existing = subjectMap.get(subject) ?? {
                scores: [],
                count: 0,
              };
              existing.scores.push(score);
              existing.count++;
              subjectMap.set(subject, existing);
            }
          }

          const subjectBreakdown = Array.from(subjectMap.entries())
            .map(([subject, data]) => ({
              subject,
              averageScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
              totalQuizzes: data.count,
            }))
            .sort((a, b) => b.totalQuizzes - a.totalQuizzes)
            .slice(0, 10);

          // Streak calculation — consecutive days with completed quizzes
          const streak = calculateStreak(
            recentQuizzes.map((q) => q.completedAt).filter(Boolean) as Date[],
          );

          // Trend — compare first half vs second half of period
          const trend = calculateTrend(recentQuizzes);

          // Aggregate strengths/weaknesses across results
          const allStrengths: string[] = [];
          const allWeaknesses: string[] = [];
          for (const quiz of recentQuizzes.slice(0, 10)) {
            if (quiz.result?.strengths) {
              const s = quiz.result.strengths as string[];
              if (Array.isArray(s)) allStrengths.push(...s);
            }
            if (quiz.result?.weaknesses) {
              const w = quiz.result.weaknesses as string[];
              if (Array.isArray(w)) allWeaknesses.push(...w);
            }
          }

          const result = {
            overview: {
              totalQuizzes: stats._count.id,
              averageScore: Math.round(scoreStats._avg.percentage ?? 0),
              bestScore: Math.round(scoreStats._max.percentage ?? 0),
              worstScore: Math.round(scoreStats._min.percentage ?? 0),
              averageTimeSpent: stats._avg.timeSpent ? Math.round(stats._avg.timeSpent) : null,
              currentStreak: streak,
            },
            subjectBreakdown,
            topStrengths: getTopFrequent(allStrengths, 5),
            topWeaknesses: getTopFrequent(allWeaknesses, 5),
            recentTrend: trend,
            period,
          };

          logger.log(
            `[TOOL:getQuizStats] Found ${stats._count.id} quizzes, avg ${result.overview.averageScore}%`,
          );

          return result;
        } catch (error) {
          logger.error(`[TOOL:getQuizStats] Error:`, error);
          return { error: "Failed to retrieve quiz statistics", overview: null };
        }
      },
    }),

    getRecentQuizResults: tool({
      description: `Retrieves the user's most recent completed quiz results with scores, subjects, difficulty levels, and dates. Use when the user asks about their recent quiz attempts or results.`,
      inputSchema: z.object({
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe("Number of recent results to return"),
      }),
      execute: async ({ limit }) => {
        logger.log(`[TOOL:getRecentQuizResults] userId=${ctx.userId}, limit=${limit}`);

        try {
          const quizzes = await prisma.quiz.findMany({
            where: {
              userId: ctx.userId,
              isCompleted: true,
            },
            select: {
              id: true,
              title: true,
              subjects: true,
              difficulty: true,
              timeSpent: true,
              completedAt: true,
              preset: true,
              result: {
                select: {
                  percentage: true,
                  totalScore: true,
                  maxScore: true,
                  adaptedGrade: true,
                  gradeScale: true,
                  strengths: true,
                  weaknesses: true,
                },
              },
            },
            orderBy: { completedAt: "desc" },
            take: limit,
          });

          const results = quizzes.map((q) => ({
            title: q.title,
            subjects: extractSubjects(q.subjects, q.title),
            difficulty: q.difficulty ?? "unknown",
            score: q.result ? `${q.result.totalScore}/${q.result.maxScore}` : null,
            percentage: q.result ? Math.round(q.result.percentage) : null,
            grade: q.result ? `${q.result.adaptedGrade}/${q.result.gradeScale}` : null,
            timeSpent: q.timeSpent ? `${Math.floor(q.timeSpent / 60)}m${q.timeSpent % 60}s` : null,
            completedAt: q.completedAt?.toISOString() ?? null,
            strengths: Array.isArray(q.result?.strengths)
              ? (q.result.strengths as string[]).slice(0, 3)
              : [],
            weaknesses: Array.isArray(q.result?.weaknesses)
              ? (q.result.weaknesses as string[]).slice(0, 3)
              : [],
          }));

          logger.log(`[TOOL:getRecentQuizResults] Returned ${results.length} results`);

          return { count: results.length, results };
        } catch (error) {
          logger.error(`[TOOL:getRecentQuizResults] Error:`, error);
          return { error: "Failed to retrieve recent quiz results", results: [] };
        }
      },
    }),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractSubjects(subjects: unknown, fallbackTitle: string): string[] {
  if (Array.isArray(subjects) && subjects.length > 0) {
    return subjects.map((s: unknown) =>
      typeof s === "string"
        ? s
        : typeof s === "object" && s !== null && "name" in s
          ? String((s as { name: string }).name)
          : String(s),
    );
  }
  return [fallbackTitle];
}

function calculateStreak(dates: Date[]): number {
  if (dates.length === 0) return 0;

  const uniqueDays = new Set(dates.map((d) => d.toISOString().slice(0, 10)));
  const sortedDays = Array.from(uniqueDays).sort().reverse();

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < sortedDays.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().slice(0, 10);

    if (sortedDays.includes(expectedStr)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function calculateTrend(
  quizzes: Array<{ result?: { percentage: number } | null }>,
): "improving" | "declining" | "stable" {
  if (quizzes.length < 4) return "stable";

  const mid = Math.floor(quizzes.length / 2);
  // quizzes are ordered desc — first half = recent, second half = older
  const recentAvg = avg(quizzes.slice(0, mid).map((q) => q.result?.percentage ?? 0));
  const olderAvg = avg(quizzes.slice(mid).map((q) => q.result?.percentage ?? 0));

  const diff = recentAvg - olderAvg;
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "stable";
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getTopFrequent(items: string[], limit: number): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    freq.set(item, (freq.get(item) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}
