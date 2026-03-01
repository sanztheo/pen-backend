/**
 * Retention Cohort Service
 * Computes weekly retention cohorts and stores them in retention_cohorts table.
 * CRON runs weekly. API reads from pre-computed table with Redis cache.
 */

import { prisma } from "../../lib/prisma.js";
import { redisCache } from "../cache/redisCache.js";
import { logger } from "../../utils/logger.js";
import { z } from "zod";
import { CohortRetention, RetentionCohortsResponse } from "../../types/admin.types.js";

const CACHE_NAMESPACE = "admin";
const COHORTS_CACHE_TTL = 3600; // 1 hour
const MAX_COHORT_WEEKS = 12;
const MAX_RETENTION_WEEKS = 4;

const CohortRetentionSchema = z.object({
  week: z.string(),
  totalUsers: z.number(),
  retention: z.array(z.number()),
});

const RetentionCohortsSchema = z.object({
  cohorts: z.array(CohortRetentionSchema),
  maxWeeks: z.number(),
}) satisfies z.ZodType<RetentionCohortsResponse>;

export class RetentionCohortService {
  /**
   * Get retention cohorts from pre-computed table, with Redis cache.
   */
  static async getCohorts(weeks: number): Promise<RetentionCohortsResponse> {
    const clampedWeeks = Math.min(Math.max(weeks, 1), MAX_COHORT_WEEKS);
    const cacheKey = `metrics:cohorts:${clampedWeeks}`;

    return redisCache.getOrSet(
      cacheKey,
      () => this.readCohortsFromDB(clampedWeeks),
      (value) => RetentionCohortsSchema.parse(value),
      { namespace: CACHE_NAMESPACE, ttl: COHORTS_CACHE_TTL },
    );
  }

  /**
   * Read pre-computed cohorts from DB and format for API response.
   */
  private static async readCohortsFromDB(weeks: number): Promise<RetentionCohortsResponse> {
    // Get distinct cohort weeks, most recent first
    const cohortWeeks = await prisma.retentionCohort.findMany({
      select: { cohortWeek: true },
      distinct: ["cohortWeek"],
      orderBy: { cohortWeek: "desc" },
      take: weeks,
    });

    if (cohortWeeks.length === 0) {
      return { cohorts: [], maxWeeks: MAX_RETENTION_WEEKS };
    }

    const weekLabels = cohortWeeks.map((c) => c.cohortWeek);

    // Fetch all retention data for these cohort weeks
    const rows = await prisma.retentionCohort.findMany({
      where: { cohortWeek: { in: weekLabels } },
      orderBy: [{ cohortWeek: "desc" }, { weekNumber: "asc" }],
    });

    // Group by cohort week
    const grouped = new Map<string, CohortRetention>();

    for (const row of rows) {
      let cohort = grouped.get(row.cohortWeek);
      if (!cohort) {
        cohort = {
          week: row.cohortWeek,
          totalUsers: row.totalUsers,
          retention: [],
        };
        grouped.set(row.cohortWeek, cohort);
      }
      cohort.retention.push(Math.round(row.retentionRate * 100) / 100);
    }

    // Sort by week descending
    const cohorts = Array.from(grouped.values()).sort((a, b) => b.week.localeCompare(a.week));

    return { cohorts, maxWeeks: MAX_RETENTION_WEEKS };
  }

  /**
   * Compute and store retention cohorts. Called by weekly CRON.
   * For each of the last MAX_COHORT_WEEKS signup cohorts, computes
   * retention at week 0, 1, 2, 3, 4.
   */
  static async computeAndStoreCohorts(): Promise<void> {
    logger.log("[RETENTION_COHORT] Computing retention cohorts...");

    const now = new Date();

    for (let cohortOffset = 0; cohortOffset < MAX_COHORT_WEEKS; cohortOffset++) {
      const cohortStart = getWeekStart(now, -cohortOffset);
      const cohortEnd = new Date(cohortStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const cohortLabel = formatISOWeek(cohortStart);

      // Users who signed up in this cohort week
      const cohortUsers = await prisma.user.findMany({
        where: {
          createdAt: { gte: cohortStart, lt: cohortEnd },
          isActive: true,
        },
        select: { id: true },
      });

      const totalUsers = cohortUsers.length;
      if (totalUsers === 0) continue;

      const userIds = cohortUsers.map((u) => u.id);

      // Compute retention for week 0 through MAX_RETENTION_WEEKS
      for (let weekNum = 0; weekNum <= MAX_RETENTION_WEEKS; weekNum++) {
        const weekStart = new Date(cohortStart.getTime() + weekNum * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Skip future weeks
        if (weekStart > now) break;

        // Week 0 is always 100%
        let retainedUsers = totalUsers;
        let retentionRate = 100;

        if (weekNum > 0) {
          // Count users who had activity in this week
          retainedUsers = await countActiveUsersInPeriod(userIds, weekStart, weekEnd);
          retentionRate = totalUsers > 0 ? (retainedUsers / totalUsers) * 100 : 0;
        }

        // Upsert into DB
        await prisma.retentionCohort.upsert({
          where: {
            cohortWeek_weekNumber: {
              cohortWeek: cohortLabel,
              weekNumber: weekNum,
            },
          },
          update: {
            totalUsers,
            retainedUsers,
            retentionRate: Math.round(retentionRate * 100) / 100,
            computedAt: new Date(),
          },
          create: {
            cohortWeek: cohortLabel,
            weekNumber: weekNum,
            totalUsers,
            retainedUsers,
            retentionRate: Math.round(retentionRate * 100) / 100,
          },
        });
      }
    }

    // Invalidate cache
    await redisCache.invalidatePattern("metrics:cohorts:*", {
      namespace: CACHE_NAMESPACE,
    });

    logger.log("[RETENTION_COHORT] Cohort computation complete");
  }
}

/**
 * Count users from a set who were active during a period.
 * Active = had a login, created a quiz, created a page, or used AI chat.
 */
async function countActiveUsersInPeriod(
  userIds: string[],
  start: Date,
  end: Date,
): Promise<number> {
  // Users who logged in during this period
  const activeUsers = await prisma.user.count({
    where: {
      id: { in: userIds },
      OR: [
        { lastLoginAt: { gte: start, lt: end } },
        { pages: { some: { createdAt: { gte: start, lt: end } } } },
        { quizzes: { some: { createdAt: { gte: start, lt: end } } } },
        { aiConversations: { some: { createdAt: { gte: start, lt: end } } } },
      ],
    },
  });

  return activeUsers;
}

/**
 * Get the Monday (start of ISO week) for a date offset by N weeks.
 */
function getWeekStart(date: Date, offsetWeeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + offsetWeeks * 7);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Format a date as ISO week label "2026-W09".
 */
function formatISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
