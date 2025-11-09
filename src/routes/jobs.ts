/**
 * 🎯 JOBS ROUTES
 *
 * Routes pour récupérer les résultats des jobs BullMQ asynchrones
 */

import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { getJobResult, deleteJobResult } from "../lib/jobResults.js";

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

/**
 * GET /api/jobs/:jobId
 * Récupérer le résultat d'un job
 */
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "Job ID requis",
      });
    }

    const result = await getJobResult(jobId);

    if (!result) {
      return res.status(404).json({
        error: "Job non trouvé ou expiré",
        message: "Le résultat du job n'existe pas ou a expiré (TTL: 5 minutes)",
      });
    }

    // Si le job est complété, on peut optionnellement supprimer le résultat après récupération
    // Pour l'instant on le garde pour permettre plusieurs récupérations pendant le TTL
    // Décommenter la ligne suivante pour supprimer après récupération :
    // if (result.status === 'completed' || result.status === 'failed') {
    //   await deleteJobResult(jobId);
    // }

    return res.json({
      jobId,
      ...result,
    });
  } catch (error: any) {
    console.error("[JOBS] Erreur récupération résultat:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/jobs/:jobId
 * Supprimer manuellement un résultat de job
 */
router.delete("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "Job ID requis",
      });
    }

    await deleteJobResult(jobId);

    return res.json({
      success: true,
      message: "Résultat du job supprimé",
    });
  } catch (error: any) {
    console.error("[JOBS] Erreur suppression résultat:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      message: error.message,
    });
  }
});

export default router;
