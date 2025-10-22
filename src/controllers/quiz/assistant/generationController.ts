import { Request, Response } from 'express';
import { OpenAIAssistantService } from '../../../services/quiz/assistant/index.js';
import { documentSearchService } from '../../../services/quiz/documentSearchService.js';

/**
 * Contrôleur pour la génération de quiz avec l'Assistant OpenAI
 */
export class AssistantGenerationController {

  /**
   * POST /api/quiz/assistant/generate-graphics - Génère un quiz avec graphiques
   */
  static async generateAssistantGraphics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, subject, numQuestions, graphicType, library, difficulty } = req.body;

      if (!preset || !subject || !numQuestions) {
        res.status(400).json({ error: 'Preset, subject et numQuestions requis' });
        return;
      }

      console.log('🎨 Génération quiz avec graphiques via Assistant:', { preset, subject, numQuestions });

      const assistantService = new OpenAIAssistantService();
      const result = await assistantService.generateWithRetry(
        () => assistantService.generateQuizWithGraphics({
          preset,
          subject,
          numQuestions,
          graphicType,
          library,
          difficulty
        }),
        `Graphics Quiz: ${subject}`
      );

      // Retourner directement les données structurées pour compatibilité frontend
      res.status(200).json({
        success: true,
        message: 'Quiz avec graphiques généré avec succès',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur génération graphiques Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération avec graphiques',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/generate-documents - Génère un quiz avec documents
   */
  static async generateAssistantDocuments(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, subject, numQuestions, documentTopics, difficulty } = req.body;

      if (!preset || !subject || !numQuestions) {
        res.status(400).json({ error: 'Preset, subject et numQuestions requis' });
        return;
      }

      console.log('📚 Génération quiz avec documents via Assistant:', { preset, subject, numQuestions });

      const assistantService = new OpenAIAssistantService();
      const result = await assistantService.generateWithRetry(
        () => assistantService.generateQuizWithDocuments({
          preset,
          subject,
          numQuestions,
          documentTopics,
          difficulty
        }),
        `Documents Quiz: ${subject}`
      );

      res.status(200).json({
        success: true,
        message: 'Quiz documentaire généré avec succès',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur génération documents Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération avec documents',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * 🆕 POST /api/quiz/assistant/generate-documents-full - Génère un quiz avec documents complets via File Upload
   */
  static async generateAssistantDocumentsFull(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, subject, numQuestions, documentTopics, difficulty, useFileUpload } = req.body;

      if (!preset || !subject || !numQuestions) {
        res.status(400).json({ error: 'Preset, subject et numQuestions requis' });
        return;
      }

      console.log('📚 Génération quiz avec documents COMPLETS via File Upload:', {
        preset, subject, numQuestions, useFileUpload
      });

      // 1. Recherche documentaire INTÉGRALE (pas de troncature à 6500 chars)
      console.log('🔍 Recherche de documents Wikipedia INTÉGRAUX pour File Upload...');

      // Recherche directe avec DocumentSearchService pour obtenir le contenu COMPLET
      let searchResult = await documentSearchService.searchDocuments({
        query: subject,
        limit: 2, // Maximum 2 documents comme dans ROADMAP
        topics: documentTopics,
        similarity_threshold: 0.6
      });

      // Si aucun résultat avec topics, essayer sans filtre
      if (!searchResult.chunks || searchResult.chunks.length === 0) {
        console.log('⚠️ Aucun résultat avec topics, recherche sans filtre...');
        searchResult = await documentSearchService.searchDocuments({
          query: subject,
          limit: 2,
          similarity_threshold: 0.4
        });
      }

      if (!searchResult.chunks || searchResult.chunks.length === 0) {
        const stats = await documentSearchService.getDocumentStats();
        res.status(404).json({
          error: 'Aucun document trouvé pour ce sujet',
          searchQuery: subject,
          topics: documentTopics,
          debug: {
            totalDocuments: stats.total_documents,
            availableTopics: stats.topics_available.slice(0, 10),
            searchStrategy: searchResult.search_strategy
          }
        });
        return;
      }

      // Convertir au format attendu
      const documentsFound = {
        documents: searchResult.chunks,
        searchTime: searchResult.execution_time_ms
      };

      // 2. Appliquer la troncature intelligente à 6500 chars (comme ROADMAP)
      console.log(`📄 ${documentsFound.documents.length} documents trouvés pour File Upload avec troncature 6500 chars`);

      // Fonction de troncature intelligente (copie de DocumentBasedQuizGenerator)
      const truncateOnSentenceEnd = (text: string, maxLength: number): string => {
        if (text.length <= maxLength) return text;

        const truncated = text.substring(0, maxLength);
        const lastPeriod = truncated.lastIndexOf('.');
        const lastExclamation = truncated.lastIndexOf('!');
        const lastQuestion = truncated.lastIndexOf('?');

        const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);

        if (lastSentenceEnd > maxLength * 0.8) {
          return truncated.substring(0, lastSentenceEnd + 1);
        }

        return truncated + '...';
      };

      // Afficher la taille des documents AVANT et APRÈS troncature
      documentsFound.documents.forEach((doc, index) => {
        const originalLength = doc.content.length;
        const truncatedLength = originalLength > 6500 ? truncateOnSentenceEnd(doc.content, 6500).length : originalLength;
        console.log(`📖 Document ${index + 1}: "${doc.title}" - ${originalLength} → ${truncatedLength} caractères (troncature intelligente)`);
      });

      // 3. Transformer les documents avec troncature à 6500 chars
      const documentsForAssistant = documentsFound.documents.map(chunk => ({
        id: chunk.id.toString(),
        title: chunk.title,
        content: truncateOnSentenceEnd(chunk.content, 6500), // Troncature intelligente à 6500 chars
        topic: chunk.topic,
        similarity: chunk.similarity,
        source: chunk.source || undefined
      }));

      // 3. Utiliser le nouveau service avec File Upload
      const assistantService = new OpenAIAssistantService();
      const result = await assistantService.generateWithRetry(
        () => assistantService.generateQuizWithFullDocuments({
          preset,
          subject,
          numQuestions,
          documents: documentsForAssistant,
          difficulty
        }),
        `Full Documents Quiz: ${subject}`
      );

      // 4. Ajouter les documents tronqués intelligemment à la réponse
      const truncatedDocuments = documentsForAssistant.map(doc => ({
        id: parseInt(doc.id),
        title: doc.title,
        content: doc.content, // Déjà tronqué à 6500 chars
        topic: doc.topic,
        similarity: doc.similarity,
        source: doc.source
      }));

      const response = {
        success: true,
        message: 'Quiz documentaire généré avec documents (6500 chars) via File Upload',
        documents: truncatedDocuments, // Documents tronqués à 6500 chars comme utilisateur les verra
        fileUploadMetadata: result?.fileUploadMetadata,
        searchMetadata: {
          query: subject,
          strategy: searchResult.search_strategy,
          documentsFound: documentsFound.documents.length,
          totalCharacters: truncatedDocuments.reduce((sum, doc) => sum + doc.content.length, 0),
          averageLength: Math.round(truncatedDocuments.reduce((sum, doc) => sum + doc.content.length, 0) / truncatedDocuments.length),
          searchTime: documentsFound.searchTime,
          maxLengthPerDocument: 6500,
          truncationMethod: 'intelligent_sentence_end'
        },
        ...result
      };

      console.log(`✅ Quiz généré avec ${documentsFound.documents.length} documents (≤6500 chars chacun) via File Upload`);
      res.status(200).json(response);

    } catch (error) {
      console.error('❌ Erreur génération documents complets:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération avec documents complets',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/generate-complete - Génère un quiz complet
   */
  static async generateAssistantComplete(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, subject, numQuestions, graphicType, library, documentTopics, difficulty } = req.body;

      if (!preset || !subject || !numQuestions) {
        res.status(400).json({ error: 'Preset, subject et numQuestions requis' });
        return;
      }

      console.log('🚀 Génération quiz complet via Assistant:', { preset, subject, numQuestions });

      const assistantService = new OpenAIAssistantService();
      const result = await assistantService.generateWithRetry(
        () => assistantService.generateCompleteQuiz({
          preset,
          subject,
          numQuestions,
          graphicType,
          library,
          documentTopics,
          difficulty
        }),
        `Complete Quiz: ${subject}`
      );

      res.status(200).json({
        success: true,
        message: 'Quiz complet multimédia généré avec succès',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur génération complète Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération complète',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/generate-standard - Génère un quiz standard
   */
  static async generateAssistantStandard(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, subject, numQuestions, difficulty, specialties, targetGrade } = req.body;

      if (!preset || !subject || !numQuestions) {
        res.status(400).json({ error: 'Preset, subject et numQuestions requis' });
        return;
      }

      console.log('⚙️ Génération quiz standard via Assistant:', { preset, subject, numQuestions });

      const assistantService = new OpenAIAssistantService();
      const result = await assistantService.generateWithRetry(
        () => assistantService.generateStandardQuiz({
          preset,
          subject,
          numQuestions,
          difficulty,
          specialties,
          targetGrade
        }),
        `Standard Quiz: ${subject}`
      );

      res.status(200).json({
        success: true,
        message: 'Quiz standard généré avec succès',
        ...result  // Spread les données directement au niveau racine
      });

    } catch (error) {
      console.error('❌ Erreur génération standard Assistant:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération standard',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}
