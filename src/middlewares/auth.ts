import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthUser } from '../services/auth.js';
import { UserSyncService } from '../services/userSync.js';

// Cache en mémoire pour la synchronisation utilisateur (userId -> timestamp)
const userSyncCache = new Map<string, number>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Extension de l'interface Request pour inclure l'utilisateur
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Middleware d'authentification
export const authenticateToken = async (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Token d\'accès requis', code: 'MISSING_TOKEN' });
    }

    const user = await AuthService.verifyToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide ou expiré', code: 'INVALID_TOKEN' });
    }

    const lastSync = userSyncCache.get(user.id);
    if (lastSync && (Date.now() - lastSync < CACHE_DURATION_MS)) {
      // Le cache est récent, on évite la synchronisation
      req.user = user;
      return next();
    }

    // Synchroniser l'utilisateur avec PostgreSQL
    try {
      const syncedUser = await UserSyncService.syncUser(user);
      userSyncCache.set(user.id, Date.now()); // Mettre à jour le cache
      req.user = { ...user, id: syncedUser.id } as AuthUser;
      next();
    } catch (error) {
      console.error('❌ [AUTH] ÉCHEC CRITIQUE sync utilisateur:', error);
      return res.status(500).json({
        error: 'Erreur de synchronisation utilisateur. Veuillez réessayer.',
        code: 'USER_SYNC_FAILED'
      });
    }
  } catch (error) {
    console.error('Erreur middleware auth:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur', code: 'AUTH_ERROR' });
  }
};

// Middleware optionnel (n'échoue pas si pas de token)
export const optionalAuth = async (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const user = await AuthService.verifyToken(token);
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    console.error('Erreur middleware auth optionnel:', error);
    next(); // Continue même en cas d'erreur
  }
};

// Middleware pour garantir la présence de req.user
export const requireUser = (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Utilisateur non authentifié', code: 'USER_REQUIRED' });
  }
  next();
};

// Middleware pour vérifier les rôles
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise', code: 'AUTH_REQUIRED' });
    }
    // TODO: Implémenter la vérification des rôles
    next();
  };
};
 
