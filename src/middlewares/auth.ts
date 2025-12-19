import { Request, Response, NextFunction } from "express";
import { AuthService, AuthUser } from "../services/auth.js";
import { UserSyncService } from "../services/userSync.js";
import { createClerkClient } from "@clerk/backend";

// Cache en mémoire pour la synchronisation utilisateur (userId -> timestamp)
const userSyncCache = new Map<string, number>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Mode test pour développement uniquement
const isDevelopment = process.env.NODE_ENV === "development";
const isTestAuthEnabled = process.env.ENABLE_TEST_AUTH === "true";

// Client Clerk pour le mode test
const clerkClient = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null;

// Extension de l'interface Request pour inclure l'utilisateur
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Charge un utilisateur Clerk par son ID (pour le mode test)
 */
async function loadTestUser(clerkUserId: string): Promise<AuthUser | null> {
  if (!clerkClient) return null;

  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    return {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress || "",
      user_metadata: {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        avatar: user.imageUrl || "",
        displayName:
          user.fullName ||
          `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        language: (user.publicMetadata?.language as string) || "fr",
        theme: (user.publicMetadata?.theme as string) || "light",
      },
    };
  } catch (error) {
    console.error("[TEST AUTH] Erreur chargement utilisateur Clerk:", error);
    return null;
  }
}

// Middleware d'authentification
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Mode test: accepter X-Test-User-Id header en développement uniquement
    if (isDevelopment && isTestAuthEnabled) {
      const testUserId = req.headers["x-test-user-id"] as string;
      if (testUserId) {
        console.log(
          `🧪 [TEST AUTH] Mode test activé pour userId: ${testUserId}`,
        );
        const testUser = await loadTestUser(testUserId);
        if (testUser) {
          // Synchroniser l'utilisateur test avec la DB
          try {
            const syncedUser = await UserSyncService.syncUser(testUser);
            req.user = { ...testUser, id: syncedUser.id } as AuthUser;
            return next();
          } catch {
            // Utiliser l'ID Clerk si la sync échoue
            req.user = testUser;
            return next();
          }
        }
        return res.status(401).json({
          error: "Utilisateur test invalide",
          code: "INVALID_TEST_USER",
        });
      }
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res
        .status(401)
        .json({ error: "Token d'accès requis", code: "MISSING_TOKEN" });
    }

    const user = await AuthService.verifyToken(token);

    if (!user) {
      return res
        .status(401)
        .json({ error: "Token invalide ou expiré", code: "INVALID_TOKEN" });
    }

    const lastSync = userSyncCache.get(user.id);
    if (lastSync && Date.now() - lastSync < CACHE_DURATION_MS) {
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
      console.error("❌ [AUTH] ÉCHEC CRITIQUE sync utilisateur:", error);
      return res.status(500).json({
        error: "Erreur de synchronisation utilisateur. Veuillez réessayer.",
        code: "USER_SYNC_FAILED",
      });
    }
  } catch (error) {
    console.error("Erreur middleware auth:", error);
    return res
      .status(500)
      .json({ error: "Erreur interne du serveur", code: "AUTH_ERROR" });
  }
};

// Middleware optionnel (n'échoue pas si pas de token)
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const user = await AuthService.verifyToken(token);
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    console.error("Erreur middleware auth optionnel:", error);
    next(); // Continue même en cas d'erreur
  }
};

// Middleware pour garantir la présence de req.user
export const requireUser = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: "Utilisateur non authentifié", code: "USER_REQUIRED" });
  }
  next();
};

// Middleware pour vérifier les rôles
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Authentification requise", code: "AUTH_REQUIRED" });
    }
    // TODO: Implémenter la vérification des rôles
    next();
  };
};
