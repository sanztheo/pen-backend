/**
 * Admin Dashboard Controller
 * Handles admin check, health, and all metrics endpoints.
 *
 * Extracted from adminController.ts to keep files under 300 lines.
 */

import { logger } from "../utils/logger.js";
import { Request, Response } from "express";
import { AdminStatsService } from "../services/admin/adminStatsService.js";
import { HealthCheckService } from "../services/admin/healthCheckService.js";
import { TrendsMetricsService } from "../services/admin/trendsMetricsService.js";
import { RetentionCohortService } from "../services/admin/retentionCohortService.js";
import { LtvService } from "../services/admin/ltvService.js";
import { AICostService } from "../services/admin/aiCostService.js";
import { TrendPeriod } from "../types/admin.types.js";
import { z } from "zod";

const TrendPeriodSchema = z.enum(["7d", "30d", "90d"]);

export class AdminDashboardController {
  /**
   * GET /api/admin/check
   * Check if current user is admin (used by frontend before loading dashboard)
   */
  static async checkAdminStatus(req: Request, res: Response): Promise<void> {
    // This route uses authenticateToken only (no requireAdmin) — must check DB directly
    const { prisma } = await import("../lib/prisma.js");
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { isAdmin: true },
    });
    res.status(200).json({ success: true, data: { isAdmin: user?.isAdmin ?? false } });
  }

  /**
   * GET /api/admin/health
   */
  static async getHealthStatus(_req: Request, res: Response): Promise<void> {
    try {
      const healthData = await HealthCheckService.getHealthStatus();
      res.status(200).json({ success: true, data: healthData });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getHealthStatus error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la vérification de santé",
      });
    }
  }

  /**
   * GET /api/admin/dashboard
   */
  static async getDashboard(_req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getDashboardMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getDashboard error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du dashboard",
      });
    }
  }

  /**
   * GET /api/admin/metrics/users
   */
  static async getUserMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getUserMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getUserMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques utilisateurs",
      });
    }
  }

  /**
   * GET /api/admin/metrics/revenue
   */
  static async getRevenueMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getRevenueMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getRevenueMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques de revenus",
      });
    }
  }

  /**
   * GET /api/admin/metrics/usage
   */
  static async getUsageMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const metrics = await AdminStatsService.getUsageMetrics();
      res.status(200).json({ success: true, data: metrics });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getUsageMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques d'utilisation",
      });
    }
  }

  /**
   * GET /api/admin/metrics/trends
   * Query param: period (7d | 30d | 90d, default 30d)
   */
  static async getTrendsMetrics(req: Request, res: Response): Promise<void> {
    try {
      const rawPeriod = (req.query.period as string) || "30d";
      const parsed = TrendPeriodSchema.safeParse(rawPeriod);

      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "period invalide — valeurs acceptées : 7d, 30d, 90d",
        });
        return;
      }

      const period: TrendPeriod = parsed.data;
      const metrics = await TrendsMetricsService.getTrends(period);
      res.status(200).json({ success: true, data: metrics });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getTrendsMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des tendances",
      });
    }
  }

  /**
   * GET /api/admin/metrics/ai-costs?period=30d
   */
  static async getAICosts(req: Request, res: Response): Promise<void> {
    try {
      const rawPeriod = (req.query.period as string) || "30d";
      const parsed = TrendPeriodSchema.safeParse(rawPeriod);

      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "period invalide — valeurs acceptées : 7d, 30d, 90d",
        });
        return;
      }

      const period: TrendPeriod = parsed.data;
      const data = await AICostService.getAICosts(period);
      res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[ADMIN_DASHBOARD] getAICosts error:", { message });
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des coûts AI",
      });
    }
  }

  /**
   * GET /api/admin/metrics/cohorts
   * Query param: weeks (1-12, default 12)
   */
  static async getRetentionCohorts(req: Request, res: Response): Promise<void> {
    try {
      const rawWeeks = req.query.weeks ? parseInt(req.query.weeks as string, 10) : 12;
      const weeks = isNaN(rawWeeks) || rawWeeks < 1 ? 12 : Math.min(rawWeeks, 12);

      const data = await RetentionCohortService.getCohorts(weeks);
      res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getRetentionCohorts error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des cohortes de rétention",
      });
    }
  }

  /**
   * GET /api/admin/metrics/ltv
   */
  static async getLtvMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const data = await LtvService.getLtvMetrics();
      res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      logger.error("[ADMIN_DASHBOARD] getLtvMetrics error:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des métriques LTV",
      });
    }
  }
}
