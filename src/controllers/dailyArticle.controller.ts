import { Request, Response } from 'express';
import { FuturaRssService } from '../services/futuraRss.service.js';
import { secureError } from '../lib/secureLogging.js';

export class DailyArticleController {
  /**
   * Récupère l'article scientifique du jour
   * GET /api/daily-article
   */
  async getDailyArticle(req: Request, res: Response) {
    try {
      // Essayer d'abord de récupérer l'article du jour
      let article = await FuturaRssService.getDailyArticle();

      // Si aucun article du jour n'est disponible, récupérer le dernier article disponible
      if (!article) {
        console.log('⚠️ [DAILY-ARTICLE] Aucun article du jour, récupération du dernier disponible...');
        article = await FuturaRssService.getLatestAvailableArticle();
      }

      // Si toujours aucun article (base vide), retourner une erreur
      if (!article) {
        return res.status(404).json({
          success: false,
          error: 'Aucun article disponible'
        });
      }

      res.json({
        success: true,
        data: {
          id: article.id,
          title: article.title,
          description: article.description,
          url: article.url,
          imageUrl: article.imageUrl,
          publishedAt: article.publishedAt,
          fetchedAt: article.fetchedAt
        },
        metadata: {
          source: 'Futura Sciences',
          fetchedAt: article.fetchedAt,
          isToday: this.isToday(article.fetchedAt)
        }
      });

    } catch (error) {
      secureError('[DAILY-ARTICLE-API] Erreur récupération article', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors de la récupération de l\'article'
      });
    }
  }

  /**
   * Vérifie si une date est aujourd'hui
   */
  private isToday(date: Date): boolean {
    const today = new Date();
    const checkDate = new Date(date);
    return (
      checkDate.getDate() === today.getDate() &&
      checkDate.getMonth() === today.getMonth() &&
      checkDate.getFullYear() === today.getFullYear()
    );
  }

  /**
   * Force le fetch d'un nouvel article aléatoire
   * POST /api/daily-article/refresh
   */
  async refreshDailyArticle(req: Request, res: Response) {
    try {

      const latestArticle = await FuturaRssService.fetchLatestArticle();

      if (!latestArticle) {
        return res.status(500).json({
          success: false,
          error: 'Impossible de récupérer un article depuis Futura Sciences'
        });
      }

      // Forcer la création d'un nouvel article même s'il y en a déjà un aujourd'hui
      const savedArticle = await FuturaRssService.saveDailyArticle(latestArticle, true);

      if (!savedArticle) {
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la sauvegarde de l\'article'
        });
      }


      res.json({
        success: true,
        data: {
          id: savedArticle.id,
          title: savedArticle.title,
          description: savedArticle.description,
          url: savedArticle.url,
          imageUrl: savedArticle.imageUrl,
          publishedAt: savedArticle.publishedAt,
          fetchedAt: savedArticle.fetchedAt
        },
        message: 'Article rafraîchi avec succès'
      });

    } catch (error) {
      secureError('[DAILY-ARTICLE-API] Erreur refresh article', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur lors du rafraîchissement de l\'article'
      });
    }
  }
}
