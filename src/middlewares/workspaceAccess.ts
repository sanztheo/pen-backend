/**
 * 🛡️ MIDDLEWARE DE CONTRÔLE D'ACCÈS AUX WORKSPACES
 *
 * Vérifie que l'utilisateur a bien accès au workspace avant toute opération.
 * Protège contre les accès non autorisés aux conversations et données d'autres utilisateurs.
 *
 * SÉCURITÉ:
 * - Valide userId + workspaceId sur chaque requête
 * - Vérifie que l'utilisateur est propriétaire OU membre du workspace
 * - Bloque l'accès aux workspaces des autres utilisateurs
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

/**
 * Vérifie que l'utilisateur authentifié a accès au workspace spécifié
 *
 * Le workspaceId peut être fourni via:
 * - req.params.workspaceId (URL)
 * - req.query.workspaceId (query string)
 * - req.body.workspaceId (body)
 */
export const verifyWorkspaceAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "USER_NOT_AUTHENTICATED",
      });
    }

    // Récupérer le workspaceId depuis params, query ou body
    const workspaceId =
      req.params.workspaceId ||
      (req.query.workspaceId as string) ||
      req.body.workspaceId;

    if (!workspaceId) {
      return res.status(400).json({
        error: "workspaceId requis",
        code: "WORKSPACE_ID_REQUIRED",
      });
    }

    // Vérifier que le workspace existe et que l'utilisateur y a accès
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          // L'utilisateur est propriétaire
          { ownerId: userId },
          // OU l'utilisateur est membre actif
          {
            members: {
              some: {
                userId,
                isActive: true,
              },
            },
          },
        ],
      },
    });

    if (!workspace) {
      console.warn(
        `🚨 [WORKSPACE-ACCESS] Tentative d'accès non autorisé: userId=${userId}, workspaceId=${workspaceId}`,
      );
      return res.status(403).json({
        error: "Accès au workspace refusé",
        code: "WORKSPACE_ACCESS_DENIED",
      });
    }

    // Workspace valide, continuer
    next();
  } catch (error) {
    console.error("[WORKSPACE-ACCESS] Erreur lors de la vérification:", error);
    return res.status(500).json({
      error: "Erreur lors de la vérification des permissions",
      code: "WORKSPACE_ACCESS_ERROR",
    });
  }
};

/**
 * Vérifie que l'utilisateur est PROPRIÉTAIRE du workspace
 * (pour opérations critiques comme suppression, modification des permissions)
 */
export const verifyWorkspaceOwnership = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "USER_NOT_AUTHENTICATED",
      });
    }

    const workspaceId =
      req.params.workspaceId ||
      (req.query.workspaceId as string) ||
      req.body.workspaceId;

    if (!workspaceId) {
      return res.status(400).json({
        error: "workspaceId requis",
        code: "WORKSPACE_ID_REQUIRED",
      });
    }

    // Vérifier que l'utilisateur est propriétaire
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        ownerId: userId,
      },
    });

    if (!workspace) {
      console.warn(
        `🚨 [WORKSPACE-OWNERSHIP] Tentative d'opération propriétaire non autorisée: userId=${userId}, workspaceId=${workspaceId}`,
      );
      return res.status(403).json({
        error:
          "Seul le propriétaire du workspace peut effectuer cette opération",
        code: "WORKSPACE_OWNER_REQUIRED",
      });
    }

    next();
  } catch (error) {
    console.error(
      "[WORKSPACE-OWNERSHIP] Erreur lors de la vérification:",
      error,
    );
    return res.status(500).json({
      error: "Erreur lors de la vérification des permissions",
      code: "WORKSPACE_OWNERSHIP_ERROR",
    });
  }
};

/**
 * Vérifie que l'utilisateur a accès à une conversation spécifique
 * (pour endpoints /conversations/:id)
 */
export const verifyConversationAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Utilisateur non authentifié",
        code: "USER_NOT_AUTHENTICATED",
      });
    }

    const conversationId = req.params.id || req.params.conversationId;

    if (!conversationId) {
      return res.status(400).json({
        error: "conversationId requis",
        code: "CONVERSATION_ID_REQUIRED",
      });
    }

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (!conversation) {
      console.warn(
        `🚨 [CONVERSATION-ACCESS] Tentative d'accès non autorisé: userId=${userId}, conversationId=${conversationId}`,
      );
      return res.status(403).json({
        error: "Accès à la conversation refusé",
        code: "CONVERSATION_ACCESS_DENIED",
      });
    }

    // Conversation valide, continuer
    next();
  } catch (error) {
    console.error(
      "[CONVERSATION-ACCESS] Erreur lors de la vérification:",
      error,
    );
    return res.status(500).json({
      error: "Erreur lors de la vérification des permissions",
      code: "CONVERSATION_ACCESS_ERROR",
    });
  }
};
