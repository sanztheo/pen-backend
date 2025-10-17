import { Router } from 'express';
import { DashboardLayoutController } from '../controllers/dashboardLayoutController.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

/**
 * GET /api/dashboard-layout
 * Récupère la disposition sauvegardée de l'utilisateur
 */
router.get('/', DashboardLayoutController.getLayout);

/**
 * PUT /api/dashboard-layout
 * Sauvegarde la disposition de l'utilisateur
 */
router.put('/', DashboardLayoutController.saveLayout);

/**
 * DELETE /api/dashboard-layout
 * Réinitialise la disposition aux valeurs par défaut
 */
router.delete('/', DashboardLayoutController.resetLayout);

export default router;

