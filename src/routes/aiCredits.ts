/**
 * 🤖 ROUTES API POUR LES CRÉDITS IA
 * Endpoints pour la gestion des crédits IA BlockNote
 */

import { logger } from "../utils/logger.js";
import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { Request } from "express";
import { AuthUser } from "../services/auth.js";
import { AICreditsService } from "../services/credits/aiCreditsService.js";

const router = express.Router();

// Interface pour les requêtes authentifiées
interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * POST /api/ai-credits/deduct
 * Déduire des crédits IA pour une action
 */
router.post("/deduct", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { action, amount = 0.5 } = req.body;
    const userId = req.user!.id;

    // 🚨 SÉCURITÉ: Validation stricte du montant
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 10) {
      logger.error(`🚨 [SÉCURITÉ] Tentative manipulation crédits par ${userId}: amount=${amount}`);
      return res.status(400).json({
        success: false,
        error: "Montant invalide",
        message: "Le montant doit être un nombre positif entre 0.1 et 10",
      });
    }

    // Vérifier si l'utilisateur peut utiliser l'IA avant de déduire
    const canUse = await AICreditsService.canUseAI(userId);
    if (!canUse) {
      return res.status(403).json({
        success: false,
        error: "Limite de crédits IA atteinte",
        remainingCredits: 0,
        limitReached: true,
      });
    }

    // Déduire les crédits
    const result = await AICreditsService.deductCredits(userId, amount, action);

    if (result.success) {
      res.json(result);
    } else {
      res.status(403).json(result);
    }
  } catch (error) {
    logger.error("Erreur déduction crédits IA:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la déduction des crédits",
      remainingCredits: 0,
      limitReached: false,
    });
  }
});

/**
 * GET /api/ai-credits/remaining
 * Obtenir le nombre de crédits restants
 */
router.get("/remaining", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const remainingCredits = await AICreditsService.getRemainingCredits(userId);

    res.json({
      success: true,
      remainingCredits,
      unlimited: remainingCredits === -1,
    });
  } catch (error) {
    logger.error("Erreur récupération crédits restants:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la récupération des crédits",
      remainingCredits: 0,
    });
  }
});

/**
 * GET /api/ai-credits/can-use
 * Vérifier si l'utilisateur peut utiliser l'IA
 */
router.get("/can-use", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const canUse = await AICreditsService.canUseAI(userId);
    const remainingCredits = await AICreditsService.getRemainingCredits(userId);

    res.json({
      success: true,
      canUse,
      remainingCredits,
      unlimited: remainingCredits === -1,
    });
  } catch (error) {
    logger.error("Erreur vérification utilisation IA:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors de la vérification",
      canUse: false,
      remainingCredits: 0,
    });
  }
});

/**
 * POST /api/ai-credits/refund
 * Rembourser des crédits IA en cas d'échec de génération
 */
router.post("/refund", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { action, amount } = req.body;
    const userId = req.user!.id;

    // 🚨 SÉCURITÉ: Validation stricte du montant de remboursement
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 10) {
      logger.error(
        `🚨 [SÉCURITÉ] Tentative manipulation remboursement par ${userId}: amount=${amount}`,
      );
      return res.status(400).json({
        success: false,
        error: "Montant de remboursement invalide",
        message: "Le montant doit être un nombre positif entre 0.1 et 10",
      });
    }

    // Valider l'action
    if (!action || typeof action !== "string") {
      return res.status(400).json({
        success: false,
        error: "Action de remboursement manquante",
        message: "L'action doit être spécifiée pour le remboursement",
      });
    }

    // 🔄 Rembourser les crédits
    logger.log(
      `🔄 [CREDITS] Remboursement demandé par ${userId}: ${amount} crédits pour action "${action}"`,
    );
    const result = await AICreditsService.refundCredits(userId, amount, action);

    if (result.success) {
      logger.log(
        `✅ [CREDITS] Remboursement réussi pour ${userId}: ${amount} crédits. Nouveau solde: ${result.newBalance}`,
      );
      res.json({
        success: true,
        newBalance: result.newBalance,
        message: `${amount} crédit${amount > 1 ? "s" : ""} remboursé${amount > 1 ? "s" : ""}`,
      });
    } else {
      logger.error(`❌ [CREDITS] Échec du remboursement pour ${userId}:`, result.error);
      res.status(400).json({
        success: false,
        error: result.error || "Échec du remboursement",
      });
    }
  } catch (error) {
    logger.error("❌ Erreur remboursement crédits IA:", error);
    res.status(500).json({
      success: false,
      error: "Erreur serveur lors du remboursement des crédits",
    });
  }
});

export { router as aiCreditsRouter };
