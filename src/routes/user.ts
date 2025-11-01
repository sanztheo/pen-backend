import { Router } from 'express';
// @ts-ignore types optional in dev
import { authenticateToken } from '../middlewares/auth.js';
import { getPersonalization, updatePersonalization } from '../controllers/user/personalizationController.js';

const router = Router();

router.use(authenticateToken);

router.get('/personalization', getPersonalization);
router.put('/personalization', updatePersonalization);

export default router;

