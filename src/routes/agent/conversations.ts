/**
 * Agent Conversation Routes
 *
 * GET /conversations — Liste des conversations
 * GET /conversations/:id — Chargement d'une conversation
 * GET /conversations/:id/status — Polling léger du status
 * DELETE /conversations/:id — Suppression (soft delete)
 */

import { logger } from "../../utils/logger.js";
import { Router } from "express";
import type { Request, Response } from "express";
import {
  loadConversation,
  listConversations,
  deleteConversation,
  getConversationStatus,
} from "../../services/agent/conversationService.js";

export const conversationRouter = Router();

/**
 * GET /api/agent/conversations
 *
 * Liste les conversations de l'utilisateur
 */
conversationRouter.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { workspaceId, limit: rawLimit } = req.query;
    const limit = Math.min(Math.max(1, parseInt(rawLimit as string) || 50), 200);

    const conversations = await listConversations(userId, workspaceId as string | undefined, limit);

    res.json({ success: true, conversations });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur liste:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors de la récupération des conversations"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});

/**
 * GET /api/agent/conversations/:id
 *
 * Charge une conversation avec ses messages + status
 */
conversationRouter.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { id } = req.params;

    const result = await loadConversation(id, userId);

    if (!result) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json({
      success: true,
      messages: result.messages,
      status: result.status,
      mode: result.mode,
      agentId: result.agentId ?? null,
      agentType: result.agentType ?? null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur chargement:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors du chargement de la conversation"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});

/**
 * GET /api/agent/conversations/:id/status
 *
 * Endpoint léger de polling — retourne uniquement le status + messageCount
 * Le frontend poll toutes les 2s quand status=STREAMING
 */
conversationRouter.get("/conversations/:id/status", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const result = await getConversationStatus(req.params.id, userId);

    if (!result) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json(result);
  } catch (error: unknown) {
    logger.error("❌ [CONVERSATIONS] Erreur status:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * DELETE /api/agent/conversations/:id
 *
 * Supprime une conversation (soft delete)
 */
conversationRouter.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const { id } = req.params;

    const deleted = await deleteConversation(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: "Conversation non trouvée" });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("❌ [CONVERSATIONS] Erreur suppression:", error);
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Erreur lors de la suppression de la conversation"
        : errorMessage;
    res.status(500).json({ error: safeMessage });
  }
});
