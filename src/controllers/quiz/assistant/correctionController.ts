import { Request, Response } from 'express';
import { OpenAIAssistantService } from '../../../services/quiz/assistant/index.js';

/**
 * Contrôleur pour la correction de quiz avec l'Assistant OpenAI
 */
export class AssistantCorrectionController {

  /**
   * POST /api/quiz/assistant/correct-graphics - Corrige un quiz avec graphiques
   */
  static async correctAssistantGraphics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { quizId, answers, graphicsData, options } = req.body;

      if (!quizId || !answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'QuizId et answers (array) requis' });
        return;
      }

      console.log('🚀 Correction graphiques via Chat Completion + JSON strict:', { quizId, answersCount: answers.length });

      const assistantService = new OpenAIAssistantService();
      // 🆕 Utiliser la correction complète pour les graphiques (schéma avancé)
      const result = await assistantService.correctWithRetry(
        () => assistantService.correctCompleteQuizChatCompletion(quizId, answers, {
          graphicsData: graphicsData || [],
          documentsData: [],
          correctionType: 'graphics',
          ...options
        }),
        `Graphics Correction (Chat Completion): ${quizId}`
      );

      res.status(200).json({
        success: true,
        message: 'Correction avec graphiques effectuée avec succès via Chat Completion',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur correction graphiques Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la correction avec graphiques',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/correct-documents - Corrige un quiz avec documents
   */
  static async correctAssistantDocuments(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { quizId, answers, documentsData, options } = req.body;

      if (!quizId || !answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'QuizId et answers (array) requis' });
        return;
      }

      console.log('🚀 Correction documents via Chat Completion + JSON strict:', { quizId, answersCount: answers.length });

      const assistantService = new OpenAIAssistantService();
      // 🆕 Utiliser la correction complète pour les documents (schéma avancé)
      const result = await assistantService.correctWithRetry(
        () => assistantService.correctCompleteQuizChatCompletion(quizId, answers, {
          graphicsData: [],
          documentsData: documentsData || [],
          correctionType: 'documents',
          ...options
        }),
        `Documents Correction (Chat Completion): ${quizId}`
      );

      res.status(200).json({
        success: true,
        message: 'Correction documentaire effectuée avec succès via Chat Completion',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur correction documents Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la correction documentaire',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/correct-complete - Corrige un quiz complet
   */
  static async correctAssistantComplete(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { quizId, answers, graphicsData, documentsData, options } = req.body;

      if (!quizId || !answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'QuizId et answers (array) requis' });
        return;
      }

      console.log('🚀 Correction complète via Chat Completion + JSON strict:', { quizId, answersCount: answers.length });

      const assistantService = new OpenAIAssistantService();
      // 🆕 Utiliser la nouvelle méthode Chat Completion complète
      const result = await assistantService.correctWithRetry(
        () => assistantService.correctCompleteQuizChatCompletion(quizId, answers, {
          graphicsData: graphicsData || [],
          documentsData: documentsData || [],
          ...options
        }),
        `Complete Correction (Chat Completion): ${quizId}`
      );

      res.status(200).json({
        success: true,
        message: 'Correction complète effectuée avec succès via Chat Completion',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur correction complète Chat Completion:', error);
      res.status(500).json({
        error: 'Erreur lors de la correction complète',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/correct-standard - Corrige un quiz standard
   */
  static async correctAssistantStandard(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { quizId, answers, options } = req.body;

      if (!quizId || !answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'QuizId et answers (array) requis' });
        return;
      }

      console.log('🚀 Correction standard via Chat Completion + JSON strict:', { quizId, answersCount: answers.length });

      const assistantService = new OpenAIAssistantService();
      // 🆕 Utiliser la nouvelle méthode Chat Completion
      const result = await assistantService.correctWithRetry(
        () => assistantService.correctStandardQuizChatCompletion(quizId, answers, options),
        `Standard Correction (Chat Completion): ${quizId}`
      );

      res.status(200).json({
        success: true,
        message: 'Correction standard effectuée avec succès via Chat Completion',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur correction standard Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la correction standard',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}
