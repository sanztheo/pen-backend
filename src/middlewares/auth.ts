import { Request, Response, NextFunction } from "express";
import { AuthService, AuthUser } from "../services/auth.js";
import { UserSyncService } from "../services/userSync.js";
import { ImpersonationService } from "../services/admin/impersonationService.js";
import { prisma } from "../lib/prisma.js";
import { createClerkClient } from "@clerk/backend";
import { SecureLogger } from "./secureLogging.js";
import { logger } from "../utils/logger.js";
import { withTimeout, CLERK_TIMEOUT_MS } from "../utils/timeout.js";

// Cache en mémoire pour la synchronisation utilisateur (userId -> timestamp)
const userSyncCache = new Map<string, number>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
// Éviction périodique des entrées expirées (toutes les 5 minutes)
const userSyncCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamp] of userSyncCache) {
    if (now - timestamp > CACHE_DURATION_MS) {
      userSyncCache.delete(userId);
    }
  }
}, CACHE_DURATION_MS);

// Ne pas empêcher le process de s'arrêter
userSyncCleanupInterval.unref();

// ============================================================================
// 🛡️ TEST AUTH - SÉCURITÉ MULTICOUCHE
// Cette fonctionnalité est DANGEREUSE si mal configurée. Les safeguards:
// 1. NODE_ENV doit être strictement "development"
// 2. ENABLE_TEST_AUTH doit être "true"
// 3. Un TEST_AUTH_SECRET doit être passé et correspondre
// 4. L'URL du client ne doit PAS contenir de domaine de production
// 5. Chaque usage est loggé avec niveau WARNING
// ============================================================================
const isDevelopment = process.env.NODE_ENV === "development";
const isTestAuthEnabled = process.env.ENABLE_TEST_AUTH === "true";
const testAuthSecret = process.env.TEST_AUTH_SECRET;
const clientUrl = process.env.CLIENT_URL || "";

// 🛡️ Liste des domaines de production connus (bloque le test auth)
const PRODUCTION_DOMAINS = [
  "pennote.app",
  "pennote.io",
  "pennote.fr",
  "vercel.app",
  "railway.app",
  ".vercel.app",
  ".railway.app",
];

/**
 * Vérifie si le test auth est sûr à utiliser (dev uniquement, pas de prod)
 */
function isTestAuthSafe(): boolean {
  // 🔒 Safeguard 1: NODE_ENV doit être "development"
  if (!isDevelopment) {
    return false;
  }

  // 🔒 Safeguard 2: ENABLE_TEST_AUTH doit être explicitement "true"
  if (!isTestAuthEnabled) {
    return false;
  }

  // 🔒 Safeguard 3: TEST_AUTH_SECRET doit être défini
  if (!testAuthSecret) {
    SecureLogger.warn(
      "🚨 [TEST AUTH] ENABLE_TEST_AUTH=true mais TEST_AUTH_SECRET non défini - désactivé",
    );
    return false;
  }

  // 🔒 Safeguard 4: Vérifier que CLIENT_URL ne contient pas de domaine de production
  const lowerClientUrl = clientUrl.toLowerCase();
  for (const prodDomain of PRODUCTION_DOMAINS) {
    if (lowerClientUrl.includes(prodDomain)) {
      SecureLogger.error(
        `🚨 [TEST AUTH] BLOQUÉ - Tentative d'utilisation en production! CLIENT_URL contient: ${prodDomain}`,
      );
      return false;
    }
  }

  return true;
}

// Cache de l'état de sécurité (calculé une seule fois au démarrage)
const testAuthIsSafe = isTestAuthSafe();

// Client Clerk pour le mode test
const clerkClient = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      impersonatedBy?: string;
    }
  }
}

/**
 * Charge un utilisateur Clerk par son ID (pour le mode test)
 */
async function loadTestUser(clerkUserId: string): Promise<AuthUser | null> {
  if (!clerkClient) return null;

  try {
    const user = await withTimeout(
      clerkClient.users.getUser(clerkUserId),
      CLERK_TIMEOUT_MS,
      "Clerk getUser",
    );
    return {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress || "",
      user_metadata: {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        avatar: user.imageUrl || "",
        displayName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        language: (user.publicMetadata?.language as string) || "fr",
        theme: (user.publicMetadata?.theme as string) || "light",
      },
    };
  } catch (error) {
    logger.error("[TEST AUTH] Erreur chargement utilisateur Clerk:", error);
    return null;
  }
}

/**
 * If an active impersonation session exists, swap req.user to the target user.
 * Skipped for /api/admin/* routes so the admin retains their identity for admin actions.
 */
async function applyImpersonation(req: Request): Promise<void> {
  const impToken = req.headers["x-impersonation-token"] as string | undefined;
  if (!impToken || !req.user || req.originalUrl.startsWith("/api/admin")) return;

  const payload = ImpersonationService.verifyImpersonationToken(impToken);
  if (!payload || payload.adminId !== req.user.id) return;

  const active = await ImpersonationService.isSessionActive(payload.adminId);
  if (!active) return;

  const target = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
  });
  if (!target) return;

  req.impersonatedBy = req.user.id;
  req.user = {
    id: target.id,
    email: target.email,
    user_metadata: {
      firstName: target.firstName || "",
      lastName: target.lastName || "",
      avatar: target.avatarUrl || "",
      displayName: `${target.firstName || ""} ${target.lastName || ""}`.trim(),
    },
  };
  logger.log(`[AUTH] Impersonation active: admin ${payload.adminId} → user ${target.id}`);
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 🛡️ Mode test: Sécurité multicouche obligatoire
    // Voir commentaire en haut du fichier pour les safeguards
    if (testAuthIsSafe) {
      const testUserId = req.headers["x-test-user-id"] as string;
      const providedSecret = req.headers["x-test-auth-secret"] as string;

      if (testUserId) {
        // 🔒 Safeguard 5: Vérifier que le secret correspond
        if (!providedSecret || providedSecret !== testAuthSecret) {
          SecureLogger.warn(
            `🚨 [TEST AUTH] Secret invalide ou manquant pour userId: ${testUserId}`,
          );
          return res.status(401).json({
            error: "Test auth secret invalide",
            code: "INVALID_TEST_SECRET",
          });
        }

        // 🔔 Log chaque usage (pour audit)
        SecureLogger.warn(
          `🧪 [TEST AUTH] Mode test utilisé - userId: ${testUserId} - IP: ${req.ip}`,
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
      return res.status(401).json({ error: "Token d'accès requis", code: "MISSING_TOKEN" });
    }

    const user = await AuthService.verifyToken(token);

    if (!user) {
      return res.status(401).json({ error: "Token invalide ou expiré", code: "INVALID_TOKEN" });
    }

    const lastSync = userSyncCache.get(user.id);
    if (lastSync && Date.now() - lastSync < CACHE_DURATION_MS) {
      req.user = user;
      await applyImpersonation(req);
      return next();
    }

    try {
      const syncedUser = await UserSyncService.syncUser(user);
      userSyncCache.set(user.id, Date.now());
      req.user = { ...user, id: syncedUser.id } as AuthUser;
      await applyImpersonation(req);
      next();
    } catch (error) {
      logger.error("❌ [AUTH] ÉCHEC CRITIQUE sync utilisateur:", error);
      return res.status(500).json({
        error: "Erreur de synchronisation utilisateur. Veuillez réessayer.",
        code: "USER_SYNC_FAILED",
      });
    }
  } catch (error) {
    logger.error("Erreur middleware auth:", error);
    return res.status(500).json({ error: "Erreur interne du serveur", code: "AUTH_ERROR" });
  }
};

// Middleware optionnel (n'échoue pas si pas de token)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
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
    logger.error("Erreur middleware auth optionnel:", error);
    next(); // Continue même en cas d'erreur
  }
};

// Middleware pour garantir la présence de req.user
export const requireUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: "Utilisateur non authentifié", code: "USER_REQUIRED" });
  }
  next();
};

/**
 * Blocks destructive actions during admin impersonation sessions.
 * Use on routes like delete account, cancel subscription, delete workspace, etc.
 */
export const blockImpersonation = (req: Request, res: Response, next: NextFunction) => {
  if (req.impersonatedBy) {
    return res.status(403).json({
      error: "This action is not allowed during impersonation",
      code: "IMPERSONATION_BLOCKED",
    });
  }
  next();
};
