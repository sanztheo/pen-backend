import { Request, Response } from 'express';
import { QuizService } from '../../../services/quiz/quizService.js';
import { logger } from "../../../utils/logger.js";

/**
 * Contrôleur pour la gestion des préférences utilisateur
 */
export class PreferencesController {

  /**
   * GET /api/quiz/preferences - Récupère les préférences utilisateur
   */
  static async getUserPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const preferences = await QuizService.getUserPreferences(userId);

      res.status(200).json({
        success: true,
        data: preferences
      });

    } catch (error) {
      logger.error('Erreur récupération préférences:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des préférences',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * PUT /api/quiz/preferences - Met à jour les préférences utilisateur
   */
  static async updateUserPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const preferencesData = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!preferencesData || typeof preferencesData !== 'object') {
        res.status(400).json({ error: 'Données de préférences requises' });
        return;
      }

      await QuizService.saveUserPreferences(userId, preferencesData);
      const updatedPreferences = await QuizService.getUserPreferences(userId);

      res.status(200).json({
        success: true,
        message: 'Préférences mises à jour avec succès',
        data: updatedPreferences
      });

    } catch (error) {
      logger.error('Erreur mise à jour préférences:', error);
      res.status(500).json({
        error: 'Erreur lors de la mise à jour des préférences',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}
