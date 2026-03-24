/**
 * Admin Alerts Service
 * Checks for anomalies (churn spike, error rate, revenue drop, signups spike)
 * and creates alerts in DB. Uses Redis cooldown to avoid duplicate alerts.
 * Sends notifications via Slack webhook.
 */

import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { logger } from "../../utils/logger.js";
import {
  AlertType,
  AlertSeverityLevel,
  PaginatedAlerts,
  AlertFilters,
} from "../../types/admin.types.js";
import { Prisma, AdminAlertType, AlertSeverity } from "@prisma/client";

const COOLDOWN_PREFIX = "admin:alert:cooldown:";
const COOLDOWN_TTL = 1800; // 30 minutes

// Cache key and TTL for alert metrics (avoid 6 count queries every 5 min)
const METRICS_CACHE_KEY = "admin:alert:metrics";
const METRICS_CACHE_TTL = 300; // 5 minutes — matches CRON interval

// ─── Thresholds ──────────────────────────────────────────────────────────

const CHURN_SPIKE_THRESHOLD = 0.5; // +50%
const REVENUE_DROP_THRESHOLD = 0.2; // -20%
const SIGNUPS_SPIKE_THRESHOLD = 2.0; // +200%

// ─── Cached metrics shape ───────────────────────────────────────────────

interface AlertMetrics {
  recentChurn: number;
  weeklyInactive: number;
  todaySubs: number;
  weekSubs: number;
  todaySignups: number;
  weekSignups: number;
}

function isAlertMetrics(value: unknown): value is AlertMetrics {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.recentChurn === "number" &&
    typeof v.weeklyInactive === "number" &&
    typeof v.todaySubs === "number" &&
    typeof v.weekSubs === "number" &&
    typeof v.todaySignups === "number" &&
    typeof v.weekSignups === "number"
  );
}

// ─── Alert Check Runner ──────────────────────────────────────────────────

export class AlertsService {
  /**
   * Fetch all alert-check metrics from Redis cache, or compute them from DB
   * and cache for 5 minutes to avoid repeated full-table scans.
   */
  private static async getMetrics(): Promise<AlertMetrics> {
    try {
      const cached = await redis.get(METRICS_CACHE_KEY);
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (isAlertMetrics(parsed)) {
          logger.log("[ALERTS_SERVICE] Metrics cache HIT");
          return parsed;
        }
      }
    } catch (error) {
      logger.warn("[ALERTS_SERVICE] Metrics cache read failed, falling back to DB:", error);
    }

    logger.log("[ALERTS_SERVICE] Metrics cache MISS — querying DB");

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [recentChurn, weeklyInactive, todaySubs, weekSubs, todaySignups, weekSignups] =
      await Promise.all([
        prisma.user.count({
          where: {
            isActive: true,
            lastLoginAt: {
              gte: new Date(thirtyDaysAgo.getTime() - 24 * 60 * 60 * 1000),
              lt: thirtyDaysAgo,
            },
          },
        }),
        prisma.user.count({
          where: {
            isActive: true,
            lastLoginAt: {
              gte: new Date(sevenDaysAgo.getTime() - 30 * 24 * 60 * 60 * 1000),
              lt: sevenDaysAgo,
            },
          },
        }),
        prisma.userSubscription.count({
          where: { plan: "premium", status: "active", createdAt: { gte: oneDayAgo } },
        }),
        prisma.userSubscription.count({
          where: { plan: "premium", status: "active", createdAt: { gte: sevenDaysAgo } },
        }),
        prisma.user.count({ where: { createdAt: { gte: oneDayAgo } } }),
        prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      ]);

    const metrics: AlertMetrics = {
      recentChurn,
      weeklyInactive,
      todaySubs,
      weekSubs,
      todaySignups,
      weekSignups,
    };

    try {
      await redis.setex(METRICS_CACHE_KEY, METRICS_CACHE_TTL, JSON.stringify(metrics));
    } catch (error) {
      logger.warn("[ALERTS_SERVICE] Metrics cache write failed:", error);
    }

    return metrics;
  }

  /**
   * Run all alert checks. Called by CRON every 5 minutes.
   * Fetches metrics once (cached 5 min) then evaluates thresholds.
   */
  static async runAllChecks(): Promise<void> {
    logger.log("[ALERTS_SERVICE] Running alert checks...");

    const metrics = await this.getMetrics();

    await Promise.allSettled([
      this.checkChurnSpike(metrics),
      this.checkRevenueDropDaily(metrics),
      this.checkSignupsSpike(metrics),
    ]);

    logger.log("[ALERTS_SERVICE] Alert checks completed");
  }

  /**
   * Churn spike: compare today's inactive count vs 7-day average.
   */
  private static async checkChurnSpike(metrics: AlertMetrics): Promise<void> {
    const { recentChurn, weeklyInactive } = metrics;
    const avgDailyChurn = weeklyInactive / 7;

    if (avgDailyChurn > 0 && recentChurn > avgDailyChurn * (1 + CHURN_SPIKE_THRESHOLD)) {
      await this.createAlertIfCooldown("CHURN_SPIKE", "CRITICAL", {
        message: `Churn spike détecté : ${recentChurn} utilisateurs inactifs aujourd'hui vs moyenne de ${Math.round(avgDailyChurn)}/jour`,
        metadata: {
          recentChurn,
          avgDailyChurn: Math.round(avgDailyChurn * 100) / 100,
          threshold: CHURN_SPIKE_THRESHOLD,
        },
      });
    }
  }

  /**
   * Revenue drop: compare today's new premium subs vs 7-day average.
   */
  private static async checkRevenueDropDaily(metrics: AlertMetrics): Promise<void> {
    const { todaySubs, weekSubs } = metrics;
    const avgDailySubs = weekSubs / 7;

    if (avgDailySubs > 0 && todaySubs < avgDailySubs * (1 - REVENUE_DROP_THRESHOLD)) {
      await this.createAlertIfCooldown("REVENUE_DROP", "WARNING", {
        message: `Baisse de revenus : ${todaySubs} nouvelles souscriptions aujourd'hui vs moyenne de ${Math.round(avgDailySubs)}/jour`,
        metadata: {
          todaySubs,
          avgDailySubs: Math.round(avgDailySubs * 100) / 100,
          threshold: REVENUE_DROP_THRESHOLD,
        },
      });
    }
  }

  /**
   * Signups spike: compare today's signups vs 7-day average.
   */
  private static async checkSignupsSpike(metrics: AlertMetrics): Promise<void> {
    const { todaySignups, weekSignups } = metrics;
    const avgDailySignups = weekSignups / 7;

    if (avgDailySignups > 0 && todaySignups > avgDailySignups * (1 + SIGNUPS_SPIKE_THRESHOLD)) {
      await this.createAlertIfCooldown("SIGNUPS_SPIKE", "INFO", {
        message: `Spike d'inscriptions : ${todaySignups} aujourd'hui vs moyenne de ${Math.round(avgDailySignups)}/jour (+200%)`,
        metadata: {
          todaySignups,
          avgDailySignups: Math.round(avgDailySignups * 100) / 100,
          threshold: SIGNUPS_SPIKE_THRESHOLD,
        },
      });
    }
  }

  // ─── Alert Creation with Cooldown ──────────────────────────────────────

  private static async createAlertIfCooldown(
    type: AlertType,
    severity: AlertSeverityLevel,
    data: { message: string; metadata: Record<string, unknown> },
  ): Promise<void> {
    const cooldownKey = `${COOLDOWN_PREFIX}${type}`;

    // Atomic SET NX EX: only one instance wins the race
    const acquired = await redis.set(cooldownKey, "1", "EX", COOLDOWN_TTL, "NX");
    if (!acquired) {
      logger.log(`[ALERTS_SERVICE] Cooldown active for ${type}, skipping`);
      return;
    }

    await prisma.adminAlert.create({
      data: {
        type: type as AdminAlertType,
        severity: severity as AlertSeverity,
        message: data.message,
        metadata: JSON.parse(JSON.stringify(data.metadata)),
      },
    });

    // Send Slack notification
    await this.sendSlackNotification(type, severity, data.message);

    logger.log(`[ALERTS_SERVICE] Alert created: ${type} (${severity})`);
  }

  // ─── Slack Notification ────────────────────────────────────────────────

  private static async sendSlackNotification(
    type: AlertType,
    severity: AlertSeverityLevel,
    message: string,
  ): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.warn("[ALERTS_SERVICE] SLACK_WEBHOOK_URL not configured, skipping Slack notification");
      return;
    }

    const severityEmoji: Record<AlertSeverityLevel, string> = {
      INFO: "ℹ️",
      WARNING: "⚠️",
      CRITICAL: "🚨",
    };

    const payload = {
      text: `${severityEmoji[severity]} *[${severity}] ${type}*\n${message}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${severityEmoji[severity]} *[${severity}] ${type}*\n${message}`,
          },
        },
      ],
    };

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.error(`[ALERTS_SERVICE] Slack webhook failed: ${response.status}`);
      }
    } catch (error) {
      logger.error("[ALERTS_SERVICE] Slack webhook error:", error);
    }
  }

  // ─── API Methods ───────────────────────────────────────────────────────

  /**
   * Get paginated list of alerts.
   */
  static async getAlerts(filters: AlertFilters): Promise<PaginatedAlerts> {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.AdminAlertWhereInput = {};

    if (filters.type) {
      where.type = filters.type as AdminAlertType;
    }
    if (filters.acknowledged !== undefined) {
      where.acknowledged = filters.acknowledged;
    }

    const [alerts, total] = await Promise.all([
      prisma.adminAlert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.adminAlert.count({ where }),
    ]);

    return {
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type as AlertType,
        severity: a.severity as AlertSeverityLevel,
        message: a.message,
        metadata: a.metadata as Record<string, unknown>,
        acknowledged: a.acknowledged,
        acknowledgedBy: a.acknowledgedBy,
        acknowledgedAt: a.acknowledgedAt,
        createdAt: a.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Acknowledge an alert.
   */
  static async acknowledgeAlert(
    alertId: string,
    adminUserId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const alert = await prisma.adminAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return { success: false, error: "Alerte non trouvée" };
    }

    if (alert.acknowledged) {
      return { success: false, error: "Alerte déjà acquittée" };
    }

    await prisma.adminAlert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedBy: adminUserId,
        acknowledgedAt: new Date(),
      },
    });

    return { success: true };
  }
}
