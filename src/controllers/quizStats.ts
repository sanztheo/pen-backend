import { Request, Response } from 'express';
import { StatsService } from '../services/quiz/statsService.js';
import { DashboardLayoutService } from '../services/quiz/dashboardLayoutService.js';
import { logger } from "../utils/logger.js";

/**
 * Contrôleur pour les statistiques de quiz
 */
export class QuizStatsController {
  /**
   * GET /api/quiz/statistics/advanced
   * Récupère les statistiques avancées complètes
   */
  static async getAdvancedStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const stats = await StatsService.getAdvancedUserStats(userId);

      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération stats avancées:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/progression
   * Récupère la progression dans le temps
   */
  static async getProgression(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const period = (req.query.period as 'week' | 'month' | 'year') || 'month';

      if (!['week', 'month', 'year'].includes(period)) {
        res.status(400).json({
          success: false,
          error: 'Période invalide. Valeurs acceptées: week, month, year'
        });
        return;
      }

      const progression = await StatsService.getProgressionOverTime(userId, period);

      res.status(200).json({
        success: true,
        data: {
          period,
          progression
        }
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération progression:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération de la progression',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/subjects
   * Récupère la répartition par matière
   */
  static async getSubjectBreakdown(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const subjects = await StatsService.getSubjectBreakdown(userId);

      res.status(200).json({
        success: true,
        data: subjects
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération matières:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des matières',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/difficulty
   * Récupère l'analyse par difficulté
   */
  static async getDifficultyAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const analysis = await StatsService.getDifficultyAnalysis(userId);

      res.status(200).json({
        success: true,
        data: analysis
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur analyse difficulté:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'analyse de difficulté',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/time
   * Récupère l'analyse du temps
   */
  static async getTimeAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const timeAnalytics = await StatsService.getTimeAnalytics(userId);

      res.status(200).json({
        success: true,
        data: timeAnalytics
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur analyse temps:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'analyse du temps',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/sources
   * Récupère les stats des pages sources
   */
  static async getPageSources(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const sources = await StatsService.getPageSourcesUsage(userId);

      res.status(200).json({
        success: true,
        data: sources
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération sources:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des sources',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/question-types
   * Récupère les stats par type de question
   */
  static async getQuestionTypeStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const questionTypes = await StatsService.getQuestionTypeStats(userId);

      res.status(200).json({
        success: true,
        data: questionTypes
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération types questions:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des types de questions',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/layout
   * Récupère le layout du dashboard
   */
  static async getLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const layout = await DashboardLayoutService.getUserLayout(userId);

      res.status(200).json({
        success: true,
        data: layout
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération layout:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération du layout',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * PUT /api/quiz/statistics/layout
   * Sauvegarde le layout du dashboard
   */
  static async saveLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const { layout, visibleCharts } = req.body;

      if (!layout || !visibleCharts) {
        res.status(400).json({
          success: false,
          error: 'Layout et visibleCharts requis'
        });
        return;
      }

      const savedLayout = await DashboardLayoutService.saveUserLayout(
        userId,
        layout,
        visibleCharts
      );

      res.status(200).json({
        success: true,
        data: savedLayout,
        message: 'Layout sauvegardé avec succès'
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur sauvegarde layout:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la sauvegarde du layout',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/statistics/layout/reset
   * Réinitialise le layout au défaut
   */
  static async resetLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const defaultLayout = await DashboardLayoutService.resetToDefault(userId);

      res.status(200).json({
        success: true,
        data: defaultLayout,
        message: 'Layout réinitialisé au défaut'
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur réinitialisation layout:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la réinitialisation du layout',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/statistics/all
   * Récupère toutes les statistiques en une seule requête (optimisation)
   */
  static async getAllStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: 'Utilisateur non authentifié'
        });
        return;
      }

      const period = (req.query.period as 'week' | 'month' | 'year') || 'month';

      // Récupérer toutes les stats en parallèle avec filtrage par période
      const [
        advanced,
        progression,
        subjects,
        difficulty,
        timeAnalytics,
        sources,
        questionTypes
      ] = await Promise.all([
        StatsService.getAdvancedUserStats(userId, period),
        StatsService.getProgressionOverTime(userId, period),
        StatsService.getSubjectBreakdown(userId, period),
        StatsService.getDifficultyAnalysis(userId, period),
        StatsService.getTimeAnalytics(userId, period),
        StatsService.getPageSourcesUsage(userId, period),
        StatsService.getQuestionTypeStats(userId, period)
      ]);

      res.status(200).json({
        success: true,
        data: {
          advanced,
          progression: {
            period,
            data: progression
          },
          subjects,
          difficulty,
          timeAnalytics,
          sources,
          questionTypes
        }
      });
    } catch (error) {
      logger.error('❌ [QuizStatsController] Erreur récupération stats complètes:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}

