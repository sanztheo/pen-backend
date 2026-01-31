import { Request, Response } from "express";
import { QuizService } from "../../../services/quiz/quizService.js";

/**
 * Contrôleur pour le debugging des séquences de quiz
 */
export class SequenceDebugController {
  /**
   * POST /api/quiz/sequence/:sequenceId/force-reset - 🔧 Forcer la réinitialisation d'état de séquence
   */
  static async forceResetSequenceState(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;
      const { action, config, resetCount } = req.body;

      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: "ID de séquence requis" });
        return;
      }

      console.log(`🔧 [DEBUG] Force reset pour séquence: ${sequenceId}`);
      console.log(`👤 Utilisateur: ${userId}`);
      console.log(`🎯 Action: ${action}`);
      console.log(`📊 Reset count: ${resetCount}`);

      // Importer le tempSequenceStorage ici pour éviter les imports circulaires
      const { tempSequenceStorage } =
        await import("../../../services/quiz/tempSequenceStorage.js");

      // 1. Récupérer la config actuelle du stockage
      let currentConfig = tempSequenceStorage.get(sequenceId);

      if (!currentConfig) {
        // Fallback: récupérer depuis QuizService si pas en cache
        const currentConfigFromService = await QuizService.getSequenceConfig(
          sequenceId,
          userId,
        );
        currentConfig = currentConfigFromService;
        console.log(
          "📋 Config récupérée depuis QuizService (pas en cache tempStorage)",
        );
      }

      if (!currentConfig) {
        res.status(404).json({ error: "Séquence non trouvée" });
        return;
      }

      console.log(`📊 Config actuelle avant reset:`, {
        currentSubjectIndex: currentConfig.currentSubjectIndex,
        totalSubjects: currentConfig.totalSubjects,
        isCompleted: currentConfig.isCompleted,
        subjectResultsCount: currentConfig.subjectResults?.length || 0,
      });

      // 2. Appliquer la config modifiée si fournie
      if (config && config.subjectResults) {
        console.log(`🔄 Application de la config modifiée...`);

        // Réinitialiser les états de génération
        let actualResetCount = 0;
        config.subjectResults.forEach(
          (
            result: {
              isGenerating?: boolean;
              isCorrecting?: boolean;
              error?: string;
              subject: string;
            },
            index: number,
          ) => {
            if (result.isGenerating || result.isCorrecting) {
              console.log(
                `🔧 Reset ${result.subject}: isGenerating=${result.isGenerating} → false, isCorrecting=${result.isCorrecting} → false`,
              );
              result.isGenerating = false;
              result.isCorrecting = false;
              result.error = undefined;
              actualResetCount++;
            }
          },
        );

        // Mettre à jour la config dans tempSequenceStorage
        const updatedConfig = { ...currentConfig, ...config };
        tempSequenceStorage.update(sequenceId, updatedConfig);

        console.log(
          `✅ ${actualResetCount} état(s) réinitialisé(s) dans tempSequenceStorage`,
        );

        // 3. Synchroniser avec la base de données
        try {
          await QuizService.syncSequenceToDatabase(sequenceId, updatedConfig);
          console.log(`✅ Sync BDD réussie`);
        } catch (syncError) {
          console.error(`⚠️ Erreur sync BDD:`, syncError);
        }

        res.status(200).json({
          success: true,
          message: `États de génération réinitialisés avec succès`,
          data: {
            sequenceId,
            resetCount: actualResetCount,
            action: action || "force_reset",
            timestamp: new Date().toISOString(),
          },
        });
      } else {
        res.status(400).json({ error: "Config modifiée requise" });
      }
    } catch (error) {
      console.error("❌ Erreur force reset séquence:", error);
      res.status(500).json({
        error: "Erreur lors du reset forcé",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
}
