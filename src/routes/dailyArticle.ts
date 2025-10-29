import { Router, Request, Response, NextFunction } from 'express';
import { DailyArticleController } from '../controllers/dailyArticle.controller.js';

const router = Router();
const dailyArticleController = new DailyArticleController();

// Middleware pour autoriser uniquement les requêtes locales
const onlyLocalAccess = (req: Request, res: Response, next: NextFunction) => {
  const allowedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
  const clientIP = req.ip || req.socket.remoteAddress || '';

  // Vérifier si la requête vient du serveur local
  if (allowedIPs.includes(clientIP) || clientIP.includes('127.0.0.1')) {
    return next();
  }

  console.warn(`⚠️ [SECURITY] Tentative d'accès non autorisé à /refresh depuis ${clientIP}`);
  return res.status(403).json({
    success: false,
    error: 'Accès interdit - Route réservée aux opérations internes'
  });
};

// 📰 Route publique - Récupérer l'article du jour (pas d'auth requise)
router.get('/', (req, res) => {
  dailyArticleController.getDailyArticle(req, res);
});

// 🔄 Route protégée - Forcer le refresh de l'article (UNIQUEMENT depuis le serveur)
// Cette route est utilisée par le cron job interne pour actualiser l'article
router.post('/refresh', onlyLocalAccess, (req, res) => {
  dailyArticleController.refreshDailyArticle(req, res);
});

export default router;
