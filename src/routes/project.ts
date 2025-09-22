import { Router } from 'express';
import { 
  createProject, 
  getWorkspaceProjects, 
  getProject, 
  updateProject, 
  deleteProject,
  toggleProjectPin
} from '../controllers/project.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// Routes des projets
router.post('/', createProject);
router.get('/workspace/:workspaceId', getWorkspaceProjects);
router.get('/:id', getProject);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);
router.patch('/:id/pin', toggleProjectPin);

export default router; 