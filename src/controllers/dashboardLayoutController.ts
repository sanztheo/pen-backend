import { Request, Response } from 'express';
import { DashboardLayoutService } from '../services/dashboardLayoutService.js';

/**
 * Contrôleur pour la gestion de la disposition du dashboard
 */
export const DashboardLayoutController = {
  /**
   * GET /api/dashboard-layout
   * Récupère la disposition sauvegardée de l'utilisateur
   */
  async getLayout(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const layout = await DashboardLayoutService.getUserLayout(userId);

      if (!layout) {
        // Retourne les valeurs par défaut si aucun layout sauvegardé
        return res.json({
          visibleCharts: [
            'progression-area',
            'subject-performance-bar',
            'difficulty-radar',
            'time-analytics-line',
          ],
          layout: [],
        });
      }

      return res.json(layout);
    } catch (error) {
      console.error('Erreur lors de la récupération du layout:', error);
      return res.status(500).json({
        error: 'Erreur lors de la récupération de la disposition',
      });
    }
  },

  /**
   * PUT /api/dashboard-layout
   * Sauvegarde la disposition de l'utilisateur
   */
  async saveLayout(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { visibleCharts, layout } = req.body;

      if (!Array.isArray(visibleCharts)) {
        return res.status(400).json({
          error: 'visibleCharts doit être un tableau',
        });
      }

      const savedLayout = await DashboardLayoutService.saveUserLayout(userId, {
        visibleCharts,
        layout: layout || [],
      });

      return res.json(savedLayout);
    } catch (error) {
      console.error('Erreur lors de la sauvegarde du layout:', error);
      return res.status(500).json({
        error: 'Erreur lors de la sauvegarde de la disposition',
      });
    }
  },

  /**
   * DELETE /api/dashboard-layout
   * Réinitialise la disposition aux valeurs par défaut
   */
  async resetLayout(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      await DashboardLayoutService.resetUserLayout(userId);

      return res.json({
        message: 'Disposition réinitialisée',
        visibleCharts: [
          'progression-area',
          'subject-performance-bar',
          'difficulty-radar',
          'time-analytics-line',
        ],
        layout: [],
      });
    } catch (error) {
      console.error('Erreur lors de la réinitialisation du layout:', error);
      return res.status(500).json({
        error: 'Erreur lors de la réinitialisation de la disposition',
      });
    }
  },
};

