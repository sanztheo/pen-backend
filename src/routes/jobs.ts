/**
 * 🎯 JOBS ROUTES
 *
 * Routes pour récupérer les résultats des jobs BullMQ asynchrones
 *
 * 🛡️ SÉCURITÉ: Chaque job est associé à un userId pour empêcher
 * l'accès aux résultats d'autres utilisateurs (IDOR protection).
 */

import { Router } from "express";
import { authenticateToken, requireUser } from "../middlewares/auth.js";
import { getJobResult, deleteJobResult } from "../lib/jobResults.js";
import { z } from "zod";

const router = Router();

// Toutes les routes nécessitent une authentification ET un user valide
router.use(authenticateToken);
router.use(requireUser);

/**
 * GET /api/jobs/:jobId
 * 🛡️ Récupérer le résultat d'un job (vérifie l'ownership)
 */
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user?.id;

    if (!jobId) {
      return res.status(400).json({
        error: "Job ID requis",
      });
    }

    // 🛡️ SÉCURITÉ: getJobResult vérifie maintenant que le job appartient à l'utilisateur
    const result = await getJobResult(jobId, userId!, z.unknown());

    if (!result) {
      return res.status(404).json({
        error: "Job non trouvé ou accès refusé",
        message:
          "Le résultat du job n'existe pas, a expiré (TTL: 5 minutes), ou ne vous appartient pas",
      });
    }

    // Si le job est complété, on peut optionnellement supprimer le résultat après récupération
    // Pour l'instant on le garde pour permettre plusieurs récupérations pendant le TTL
    // Décommenter la ligne suivante pour supprimer après récupération :
    // if (result.status === 'completed' || result.status === 'failed') {
    //   await deleteJobResult(jobId, userId!);
    // }

    return res.json({
      jobId,
      ...result,
    });
  } catch (error: unknown) {
    console.error("[JOBS] Erreur récupération résultat:", error);
    return res.status(500).json({
      error: "Erreur serveur",
    });
  }
});

/**
 * DELETE /api/jobs/:jobId
 * 🛡️ Supprimer manuellement un résultat de job (vérifie l'ownership)
 */
router.delete("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user?.id;

    if (!jobId) {
      return res.status(400).json({
        error: "Job ID requis",
      });
    }

    // 🛡️ SÉCURITÉ: deleteJobResult vérifie maintenant que le job appartient à l'utilisateur
    await deleteJobResult(jobId, userId!);

    return res.json({
      success: true,
      message: "Résultat du job supprimé",
    });
  } catch (error: unknown) {
    console.error("[JOBS] Erreur suppression résultat:", error);
    return res.status(500).json({
      error: "Erreur serveur",
    });
  }
});

export { router as jobsRouter };
