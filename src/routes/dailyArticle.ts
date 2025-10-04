import { Router } from 'express';
import { DailyArticleController } from '../controllers/dailyArticle.controller.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = Router();
const dailyArticleController = new DailyArticleController();

// 📰 Route publique - Récupérer l'article du jour (pas d'auth requise)
router.get('/', (req, res) => {
  dailyArticleController.getDailyArticle(req, res);
});

// 🔄 Route protégée - Forcer le refresh de l'article (pour test)
router.post('/refresh', authenticateToken, (req, res) => {
  dailyArticleController.refreshDailyArticle(req, res);
});

export default router;
