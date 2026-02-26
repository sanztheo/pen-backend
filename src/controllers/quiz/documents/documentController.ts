import { Request, Response } from "express";
import { documentSearchService } from "../../../services/quiz/documentSearchService.js";
import { logger } from "../../../utils/logger.js";

/**
 * Contrôleur pour la recherche documentaire
 */
export class DocumentController {
  /**
   * POST /api/quiz/search-documents - Recherche intelligente dans les documents
   */
  static async searchDocuments(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      const { query, limit = 10, similarity_threshold, topics } = req.body;

      // Validation des paramètres
      if (!query || typeof query !== "string" || query.trim() === "") {
        res.status(400).json({
          error: "Requête de recherche requise (chaîne non vide)",
        });
        return;
      }

      if (limit && (typeof limit !== "number" || limit < 1 || limit > 50)) {
        res.status(400).json({
          error: "Limite doit être un nombre entre 1 et 50",
        });
        return;
      }

      if (
        similarity_threshold &&
        (typeof similarity_threshold !== "number" ||
          similarity_threshold < 0 ||
          similarity_threshold > 1)
      ) {
        res.status(400).json({
          error: "Seuil de similarité doit être un nombre entre 0 et 1",
        });
        return;
      }

      if (topics && (!Array.isArray(topics) || topics.some((t) => typeof t !== "string"))) {
        res.status(400).json({
          error: "Topics doit être un tableau de chaînes",
        });
        return;
      }

      // Test de connexion à la base d'embeddings
      const isConnected = await documentSearchService.testConnection();
      if (!isConnected) {
        res.status(503).json({
          error: "Service de recherche documentaire indisponible",
          details: "Impossible de se connecter à la base de données d'embeddings",
        });
        return;
      }

      // Exécution de la recherche
      const searchRequest = {
        query: query.trim(),
        limit,
        similarity_threshold,
        topics,
      };

      logger.log(`🔍 Recherche documentaire pour utilisateur ${userId}:`, {
        query: searchRequest.query,
        limit: searchRequest.limit,
        topics: searchRequest.topics,
      });

      const searchResult = await documentSearchService.searchDocuments(searchRequest);

      // Log des résultats pour debug
      logger.log(
        `📊 Résultats recherche: ${searchResult.total_results} chunks en ${searchResult.execution_time_ms}ms`,
      );
      logger.log(
        `🧠 Stratégie: ${searchResult.search_strategy}, Topics détectés:`,
        searchResult.detected_topics,
      );

      res.status(200).json({
        success: true,
        message: "Recherche effectuée avec succès",
        data: {
          query: searchRequest.query,
          results: searchResult.chunks,
          metadata: {
            search_strategy: searchResult.search_strategy,
            detected_topics: searchResult.detected_topics,
            total_results: searchResult.total_results,
            execution_time_ms: searchResult.execution_time_ms,
            similarity_threshold: similarity_threshold || "auto",
          },
        },
      });
    } catch (error) {
      logger.error("Erreur recherche documentaire:", error);
      res.status(500).json({
        error: "Erreur lors de la recherche documentaire",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }

  /**
   * GET /api/quiz/documents/stats - Statistiques de la base documentaire
   */
  static async getDocumentStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Utilisateur non authentifié" });
        return;
      }

      // Test de connexion
      const isConnected = await documentSearchService.testConnection();
      if (!isConnected) {
        res.status(503).json({
          error: "Service documentaire indisponible",
          details: "Impossible de se connecter à la base de données d'embeddings",
        });
        return;
      }

      // Récupération des statistiques
      const stats = await documentSearchService.getDocumentStats();

      res.status(200).json({
        success: true,
        data: {
          database_status: "connected",
          statistics: stats,
          available_topics: stats.topics_available.sort(),
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Erreur récupération stats documentaires:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération des statistiques",
        details: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  }
}
