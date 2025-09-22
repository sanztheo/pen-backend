import { Router } from 'express';
import { getProfile, logout, profile, register, login, refresh, updateProfile, updatePassword, updateEmail } from '../controllers/auth.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = Router();

// Routes publiques (retournent des erreurs expliquant que Clerk gère cela côté client)
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);

// Routes protégées  
router.post('/logout', authenticateToken, logout);
router.get('/profile', authenticateToken, profile);
router.put('/profile', authenticateToken, updateProfile);
router.post('/update-password', authenticateToken, updatePassword);
router.post('/update-email', authenticateToken, updateEmail);

export default router; 