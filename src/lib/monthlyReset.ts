import { prisma } from "./prisma.js";
import { logger } from "../utils/logger.js";

/**
 * Batch monthly reset: single SQL statements instead of N+1 individual transactions.
 * Resets usage counters for free users whose period has elapsed.
 */
export async function processMonthlyResets(): Promise<{
  resetCount: number;
  downgradeCount: number;
}> {
  logger.log("[Monthly Reset] Starting batch reset...");

  try {
    const now = new Date();
    const newPeriodEnd = new Date(now);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    // Batch reset: single SQL updates user_limits + user_subscriptions
    // for all free users whose period has ended (next reset date <= now)
    const [resetLimitsResult] = await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE user_limits ul
        SET "aiCreditsUsed" = 0,
            "customQuizzesUsed" = 0,
            "presetSequencesUsed" = 0,
            "lastResetAt" = ${now}
        FROM user_subscriptions us
        WHERE ul."userId" = us."userId"
          AND us.plan = 'free_user'
          AND (
            us."currentPeriodEnd" IS NOT NULL AND us."currentPeriodEnd" <= ${now}
            OR us."currentPeriodEnd" IS NULL AND ul."lastResetAt" + INTERVAL '1 month' <= ${now}
          )
      `,
      prisma.$executeRaw`
        UPDATE user_subscriptions us
        SET "currentPeriodStart" = ${now},
            "currentPeriodEnd" = ${newPeriodEnd}
        WHERE us.plan = 'free_user'
          AND (
            us."currentPeriodEnd" IS NOT NULL AND us."currentPeriodEnd" <= ${now}
            OR us."currentPeriodEnd" IS NULL
          )
      `,
    ]);

    const resetCount = Number(resetLimitsResult);
    const downgradeCount = await processScheduledDowngrades(now);

    logger.log(`[Monthly Reset] Done: ${resetCount} resets, ${downgradeCount} downgrades`);

    return { resetCount, downgradeCount };
  } catch (error: unknown) {
    logger.error("[Monthly Reset] Error:", error);
    throw error;
  }
}

/**
 * Batch-process scheduled downgrades (cancelAtPeriodEnd = true).
 * Processes in chunks to avoid long-running transactions.
 */
async function processScheduledDowngrades(now: Date): Promise<number> {
  const newPeriodEnd = new Date(now);
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

  // Batch update subscriptions to free_user
  const downgradeSubsCount = await prisma.$executeRaw`
    UPDATE user_subscriptions
    SET plan = 'free_user',
        "cancelAtPeriodEnd" = false,
        "currentPeriodStart" = ${now},
        "currentPeriodEnd" = ${newPeriodEnd}
    WHERE "cancelAtPeriodEnd" = true
      AND "currentPeriodEnd" <= ${now}
  `;

  // Batch reset limits for downgraded users
  if (downgradeSubsCount > 0) {
    await prisma.$executeRaw`
      UPDATE user_limits ul
      SET "aiCreditsLimit" = 50,
          "workspacesLimit" = 2,
          "projectsLimit" = -1,
          "customQuizzesLimit" = 5,
          "presetSequencesLimit" = 1,
          "aiCreditsUsed" = 0,
          "customQuizzesUsed" = 0,
          "presetSequencesUsed" = 0,
          "lastResetAt" = ${now}
      FROM user_subscriptions us
      WHERE ul."userId" = us."userId"
        AND us.plan = 'free_user'
        AND us."cancelAtPeriodEnd" = false
        AND us."currentPeriodStart" = ${now}
    `;
  }

  return Number(downgradeSubsCount);
}
