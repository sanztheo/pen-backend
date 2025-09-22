import { Router } from 'express';
import { 
  createWorkspace, 
  getWorkspaces, 
  getWorkspaceById, 
  updateWorkspace, 
  deleteWorkspace 
} from '../controllers/workspace.js';
import { Router as _Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, requireUser } from '../middlewares/auth.js';

const router = Router();

// Toutes les routes nécessitent une authentification ET la présence de req.user
router.use(authenticateToken);
router.use(requireUser);

// Routes des workspaces
router.post('/', createWorkspace);
router.get('/', getWorkspaces);
router.get('/:id', getWorkspaceById);
router.put('/:id', updateWorkspace);
router.delete('/:id', deleteWorkspace);

// 🔎 Pages d'un workspace (pour le menu "Toutes les sources")
router.get('/:id/pages', async (req, res) => {
  try {
    const { id } = req.params;
    const pages = await prisma.page.findMany({
      where: { workspaceId: id, isArchived: false },
      select: { id: true, title: true, projectId: true, workspaceId: true, updatedAt: true, icon: true, iconColor: true },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });
    
    res.json({ pages });
  } catch (error) {
    console.error('[GET /workspaces/:id/pages] error', error);
    res.status(500).json({ error: 'Erreur liste des pages' });
  }
});

export default router; 