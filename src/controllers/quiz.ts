import { Request, Response } from 'express';
import { QuizService } from '../services/quiz/quizService.js';
import { SchoolLevel, QuestionType } from '../services/quiz/types.js';
import { documentSearchService } from '../services/quiz/documentSearchService.js';
import { OpenAIAssistantService } from '../services/quiz/assistant/index.js';
import { prisma } from '../lib/prisma.js';

// 🛡️ Fonction utilitaire pour valider sourceDocuments
const validateSourceDocuments = (sourceDocuments: any): { valid: boolean; error?: string; details?: any } => {
  if (!sourceDocuments) return { valid: true };

  if (!Array.isArray(sourceDocuments)) {
    return { valid: false, error: 'sourceDocuments doit être un tableau' };
  }

  // Limiter le nombre de documents
  if (sourceDocuments.length > 50) {
    return { 
      valid: false,
      error: 'Trop de documents sources',
      details: {
        message: 'Maximum 50 documents sources autorisés',
        provided: sourceDocuments.length,
        limit: 50
      }
    };
  }

  // Calculer la taille totale des documents
  let totalSize = 0;
  for (const doc of sourceDocuments) {
    if (typeof doc === 'string') {
      totalSize += doc.length;
    } else if (doc && typeof doc === 'object' && typeof doc.content === 'string') {
      totalSize += doc.content.length;
    } else if (doc && typeof doc === 'object' && typeof doc.text === 'string') {
      totalSize += doc.text.length;
    }
    
    // Limite par document individuel (500KB)
    const docSize = typeof doc === 'string' ? doc.length : 
      (doc?.content?.length || doc?.text?.length || 0);
    if (docSize > 500000) {
      return {
        valid: false,
        error: 'Document source trop volumineux',
        details: {
          message: 'Taille maximale par document: 500KB',
          documentSize: docSize,
          limit: 500000
        }
      };
    }
  }

  // Limite globale de taille (5MB total)
  if (totalSize > 5000000) {
    return {
      valid: false,
      error: 'Documents sources trop volumineux',
      details: {
        message: 'Taille totale maximale: 5MB',
        totalSize,
        limit: 5000000
      }
    };
  }

  return { valid: true };
};

/**
 * Contrôleur pour la gestion des quiz
 */
export class QuizController {

  /**
   * POST /api/quiz/generate - Génère un nouveau quiz
   */
  static async generateQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const {
        schoolLevel,
        preset,
        specificSubject,
        sequentialConfig,
        lyceeSpecialties,
        higherEdField,
        targetGrade,
        workspaceIds, // Deprecated - support rétrocompatibilité
        pageProjectIds, // Nouveau système
        questionTypes,
        questionCount,
        title,
        description,
        coursesOnly
      } = req.body;

      // Validation des paramètres requis
      if (!schoolLevel || !questionTypes || !questionCount) {
        res.status(400).json({ 
          error: 'Paramètres manquants: schoolLevel, questionTypes et questionCount sont requis' 
        });
        return;
      }

      // Validation des enums
      if (!Object.values(SchoolLevel).includes(schoolLevel)) {
        res.status(400).json({ error: 'Niveau scolaire invalide' });
        return;
      }

      if (!Array.isArray(questionTypes) || !questionTypes.every(type => Object.values(QuestionType).includes(type))) {
        res.status(400).json({ error: 'Types de questions invalides' });
        return;
      }

      if (questionCount < 1 || questionCount > 100) {
        res.status(400).json({ error: 'Le nombre de questions doit être entre 1 et 100' });
        return;
      }

      // Construction de la requête
      const generationRequest = {
        userId,
        schoolLevel,
        preset,
        specificSubject,
        sequentialConfig,
        lyceeSpecialties: lyceeSpecialties || [],
        higherEdField,
        targetGrade,
        workspaceIds: workspaceIds || [], // Compatibilité ancienne API
        pageProjectIds: pageProjectIds || [], // Nouvelle API
        questionTypes,
        questionCount,
        title,
        description,
        coursesOnly
      };

      // Décision du type de génération basée sur le contenu sélectionné
      let quizId: string;
      
      if (pageProjectIds && pageProjectIds.length > 0) {
        console.log('📄 Génération quiz basée sur pages/projets avec RAG:', pageProjectIds, 'coursesOnly:', coursesOnly);
        
        // 🧠 Système d'embedding automatique inspiré d'AssistantInput.tsx
        try {
          // Récupérer les pages sélectionnées
          const pages = await prisma.page.findMany({
            where: {
              id: { in: pageProjectIds },
              workspace: {
                members: {
                  some: { userId: userId }
                }
              },
              isArchived: false
            },
            select: {
              id: true,
              title: true,
              workspaceId: true,
              blockNoteContent: true,
              updatedAt: true
            }
          });

          console.log(`🔍 [QUIZ-RAG] Pages trouvées: ${pages.length}/${pageProjectIds.length}`);

          // Système d'embedding automatique pour chaque page
          if (pages.length > 0) {
            console.log(`🚀 [QUIZ-RAG] Démarrage embedding automatique pour ${pages.length} page(s)`);
            
            const { userPagesRAG } = await import('../services/rag/userPages.js');
            
            let alreadyEmbedded = 0;
            let newlyProcessed = 0;
            let embeddingErrors = 0;
            
            for (const page of pages) {
              if (!page.title || !page.blockNoteContent) {
                console.warn(`⚠️ [QUIZ-RAG] Page "${page.title || page.id}" ignorée (titre ou contenu manquant)`);
                continue;
              }

              try {
                console.log(`🔥 [QUIZ-RAG] Vérification et traitement page: "${page.title}"`);
                
                // 🔍 1. Vérification d'existence comme dans AssistantInput.tsx
                const existingSource = await userPagesRAG.findExistingSource(
                  page.id, 
                  userId, 
                  page.workspaceId
                );
                
                // 🔄 2. Décider si embedding nécessaire
                const needsEmbedding = !existingSource || 
                  existingSource.status === 'FAILED' || 
                  new Date(existingSource.updatedAt) < new Date(page.updatedAt);
                
                if (!needsEmbedding) {
                  console.log(`✅ [QUIZ-RAG] Page "${page.title}" déjà embedée et à jour → Skip`);
                  alreadyEmbedded++;
                  continue;
                }
                
                if (existingSource && existingSource.status === 'FAILED') {
                  console.log(`🔄 [QUIZ-RAG] Page "${page.title}" précédemment échouée → Re-traitement`);
                } else if (existingSource) {
                  console.log(`🔄 [QUIZ-RAG] Page "${page.title}" obsolète → Mise à jour`);
                } else {
                  console.log(`🆕 [QUIZ-RAG] Nouvelle page "${page.title}" → Premier embedding`);
                }

                // 📦 3. Extraction du contenu (logique améliorée)
                let textContent = page.title;
                try {
                  const content = typeof page.blockNoteContent === 'string' 
                    ? JSON.parse(page.blockNoteContent) 
                    : page.blockNoteContent;
                  
                  if (content && Array.isArray(content)) {
                    const textParts = content
                      .filter((block: any) => block?.type === 'paragraph' && block?.content)
                      .map((block: any) => 
                        Array.isArray(block.content) 
                          ? block.content.map((item: any) => item?.text || '').join('')
                          : ''
                      )
                      .filter(Boolean);
                    
                    if (textParts.length > 0) {
                      textContent = page.title + '\n\n' + textParts.join('\n\n');
                    }
                  }
                } catch (error) {
                  console.warn(`🧠 [QUIZ-RAG] Erreur extraction contenu page "${page.title}":`, error);
                }

                // ⚡ 4. Vérification de contenu minimum (comme AssistantInput)
                if (textContent.length < 50) {
                  console.log(`⚠️ [QUIZ-RAG] Contenu trop court pour "${page.title}" (${textContent.length} chars) → Skip embedding`);
                  continue;
                }

                // 🧠 5. Embedding immédiat et synchrone (comme AssistantInput.tsx)
                console.log(`🧠 [QUIZ-RAG] Embedding immédiat: "${page.title}" (${textContent.length} chars)`);
                
                const sourceId = await userPagesRAG.processUserPage({
                  id: page.id,
                  title: page.title,
                  content: textContent,
                  userId: userId,
                  workspaceId: page.workspaceId,
                  updatedAt: page.updatedAt
                });
                
                if (sourceId) {
                  console.log(`✅ [QUIZ-RAG] Page "${page.title}" → RAG sourceId: ${sourceId}`);
                  newlyProcessed++;
                  
                  // 🔍 Vérifier immédiatement que des chunks ont été créés
                  const chunkCount = await prisma.rAGChunk.count({
                    where: { sourceId }
                  });
                  console.log(`📊 [QUIZ-RAG] Chunks générés pour "${page.title}": ${chunkCount}`);
                  
                } else {
                  console.warn(`⚠️ [QUIZ-RAG] Échec embedding pour page "${page.title}"`);
                  embeddingErrors++;
                }
                
              } catch (error) {
                console.error(`❌ [QUIZ-RAG] Erreur embedding page "${page.title}":`, error);
                embeddingErrors++;
              }
            }
            
            console.log(`📊 [QUIZ-RAG] Résumé embedding automatique:`);
            console.log(`   • ${newlyProcessed} pages nouvellement embedées`);
            console.log(`   • ${alreadyEmbedded} pages déjà à jour`);
            console.log(`   • ${embeddingErrors} erreurs d'embedding`);
            
            // 🎯 Attendre un court délai pour que les embeddings soient disponibles
            if (newlyProcessed > 0) {
              console.log(`⏱️ [QUIZ-RAG] Attente 2s pour stabilisation des embeddings...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        } catch (error) {
          console.warn('⚠️ [QUIZ-RAG] Erreur système embedding automatique, génération continue sans RAG:', error);
        }
        
        // NOUVEAU: Génération basée sur pages/projets spécifiques avec RAG
        quizId = await QuizService.generateQuizFromPageProjects(generationRequest as any);
      } else if (workspaceIds && workspaceIds.length > 0) {
        console.log('🏢 Génération quiz basée sur workspaces:', workspaceIds, 'coursesOnly:', coursesOnly);
        // Génération basée sur workspaces (rétrocompatibilité)
        quizId = await QuizService.generateQuizFromWorkspace(generationRequest as any);
      } else {
        console.log('📚 Génération quiz générique sans contenu');
        // Génération générique
        quizId = await QuizService.generateQuiz(generationRequest);
      }

      res.status(201).json({
        success: true,
        message: 'Quiz généré avec succès',
        data: { quizId }
      });

    } catch (error) {
      console.error('Erreur génération quiz:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération du quiz',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/:id - Récupère un quiz par son ID
   */
  static async getQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const quizId = req.params.id;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!quizId) {
        res.status(400).json({ error: 'ID du quiz requis' });
        return;
      }

      const quiz = await QuizService.getQuiz(quizId, userId);

      res.status(200).json({
        success: true,
        data: quiz
      });

    } catch (error) {
      console.error('Erreur récupération quiz:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'Quiz non trouvé' });
      } else {
        res.status(500).json({
          error: 'Erreur lors de la récupération du quiz',
          details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }
    }
  }

  /**
   * POST /api/quiz/:id/submit - Soumet un quiz pour correction
   */
  static async submitQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const quizId = req.params.id;
      const { answers, sourceDocuments, hasDocuments } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!quizId) {
        res.status(400).json({ error: 'ID du quiz requis' });
        return;
      }

      if (!answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'Réponses requises sous forme de tableau' });
        return;
      }

      // 🛡️ Validation stricte de sourceDocuments pour éviter saturation mémoire
      const validation = validateSourceDocuments(sourceDocuments);
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error,
          ...validation.details
        });
        return;
      }

      const submissionData = {
        quizId,
        userId,
        answers
      };

      const quizResult = await QuizService.submitQuiz(quizId, userId, answers, sourceDocuments, hasDocuments);

      res.status(200).json({
        success: true,
        message: 'Quiz soumis et corrigé avec succès',
        result: quizResult
      });

    } catch (error) {
      console.error('Erreur soumission quiz:', error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: 'Quiz non trouvé' });
      } else if (error instanceof Error && error.message.includes('already submitted')) {
        res.status(409).json({ error: 'Quiz déjà soumis' });
      } else {
        res.status(500).json({
          error: 'Erreur lors de la soumission du quiz',
          details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }
    }
  }

  /**
   * GET /api/quiz/history - Récupère l'historique des quiz
   */
  static async getQuizHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { limit = 10, offset = 0 } = req.query;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const parsedLimit = parseInt(limit as string, 10);
      const parsedOffset = parseInt(offset as string, 10);

      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        res.status(400).json({ error: 'Limite doit être entre 1 et 100' });
        return;
      }

      if (isNaN(parsedOffset) || parsedOffset < 0) {
        res.status(400).json({ error: 'Offset doit être >= 0' });
        return;
      }

      const history = await QuizService.getQuizHistory(userId, parsedLimit, parsedOffset);

      res.status(200).json({
        success: true,
        data: {
          quizzes: history,
          pagination: {
            limit: parsedLimit,
            offset: parsedOffset
          }
        }
      });

    } catch (error) {
      console.error('Erreur récupération historique:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération de l\'historique',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/preferences - Récupère les préférences utilisateur
   */
  static async getUserPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const preferences = await QuizService.getUserPreferences(userId);

      res.status(200).json({
        success: true,
        data: preferences
      });

    } catch (error) {
      console.error('Erreur récupération préférences:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des préférences',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * PUT /api/quiz/preferences - Met à jour les préférences utilisateur
   */
  static async updateUserPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const preferencesData = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!preferencesData || typeof preferencesData !== 'object') {
        res.status(400).json({ error: 'Données de préférences requises' });
        return;
      }

      await QuizService.saveUserPreferences(userId, preferencesData);
      const updatedPreferences = await QuizService.getUserPreferences(userId);

      res.status(200).json({
        success: true,
        message: 'Préférences mises à jour avec succès',
        data: updatedPreferences
      });

    } catch (error) {
      console.error('Erreur mise à jour préférences:', error);
      res.status(500).json({
        error: 'Erreur lors de la mise à jour des préférences',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  // ===== MÉTHODES POUR QUIZ SÉQUENTIELS =====

  /**
   * POST /api/quiz/preset/start - Démarre une séquence de quiz preset
   */
  static async startPresetSequence(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { preset, selectedSpecialties, higherEdField, workspaceIds } = req.body;

      if (!preset) {
        res.status(400).json({ error: 'Type de preset requis' });
        return;
      }

      // Validation spécifique par preset
      if (preset === 'BAC' && (!selectedSpecialties || selectedSpecialties.length !== 2)) {
        res.status(400).json({ error: 'Exactement 2 spécialités requises pour le Bac' });
        return;
      }

      if (preset === 'PARTIELS' && !higherEdField) {
        res.status(400).json({ error: 'Filière d\'études requise pour les Partiels' });
        return;
      }

      // Création de la séquence via QuizService
      const result = await QuizService.startPresetSequence({
        userId,
        preset: preset as any, // Cast vers QuizPreset
        specialties: selectedSpecialties,
        higherEdField,
        workspaceIds: workspaceIds || []
      });

      // 🎯 INCRÉMENTER LE COMPTEUR presetSequencesUsed APRÈS CRÉATION RÉUSSIE
      try {
        await prisma.userLimits.upsert({
          where: { userId },
          update: {
            presetSequencesUsed: { increment: 1 }
          },
          create: {
            userId,
            presetSequencesUsed: 1,
            // Limites par défaut (FREE)
            aiCreditsLimit: 50,
            workspacesLimit: 2,
            projectsLimit: 4,
            customQuizzesLimit: 5,
            presetSequencesLimit: 1,
            aiCreditsUsed: 0,
            workspacesUsed: 0,
            projectsUsed: 0,
            customQuizzesUsed: 0
          }
        });
        
        console.log(`✅ [PRESET-COUNTER] Compteur presetSequencesUsed incrémenté pour utilisateur: ${userId}`);
      } catch (error) {
        console.error(`❌ [PRESET-COUNTER] Erreur incrémentation compteur pour utilisateur ${userId}:`, error);
      }

      res.status(201).json({
        success: true,
        message: 'Séquence de quiz créée avec succès',
        data: {
          sequenceId: result.sequenceId,
          preset,
          currentSubjectIndex: result.config.currentSubjectIndex,
          totalSubjects: result.config.totalSubjects,
          nextQuizSubject: result.config.subjects[0],
          firstQuizId: undefined, // Plus de génération automatique
          firstQuizGenerated: false
        }
      });

    } catch (error) {
      console.error('Erreur création séquence preset:', error);
      res.status(500).json({
        error: 'Erreur lors de la création de la séquence',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId - Récupère le statut d'une séquence
   */
  static async getSequenceStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: 'ID de séquence requis' });
        return;
      }

      // Récupération de la configuration de séquence
      const config = await QuizService.getSequenceConfig(sequenceId, userId);

      res.status(200).json({
        success: true,
        data: { config }
      });

    } catch (error) {
      console.error('Erreur récupération séquence:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération de la séquence',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/sequence/:sequenceId/next - Génère le quiz suivant dans la séquence
   */
  static async generateNextQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: 'ID de séquence requis' });
        return;
      }

      // Génération du quiz suivant dans la séquence
      const result = await QuizService.generateNextQuizInSequence(sequenceId, userId);

      res.status(201).json({
        success: true,
        message: 'Quiz suivant généré avec succès',
        data: {
          quizId: result.quizId,
          subject: result.subject,
          isLastQuiz: result.isLastQuiz,
          quiz: result.quiz // **NOUVEAU** : Quiz complet avec documents
        }
      });

    } catch (error) {
      console.error('Erreur génération quiz suivant:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération du quiz suivant',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/sequence/:sequenceId/parallel-generate - 🚀 Génère plusieurs quiz en parallèle
   */
  static async generateParallelQuizzes(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;
      const { count = 2 } = req.body; // Nombre de quiz à générer en parallèle

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: 'ID de séquence requis' });
        return;
      }

      if (count < 1 || count > 5) {
        res.status(400).json({ error: 'Le nombre de quiz doit être entre 1 et 5' });
        return;
      }

      console.log(`⚡ Démarrage génération parallèle: ${count} quiz pour séquence ${sequenceId}`);

      // Génération parallèle avec 2 assistants
      const results = await QuizService.generateSequenceQuizzesParallel(sequenceId, userId, count);

      const successCount = results.filter(r => r.success).length;
      const totalTime = results.reduce((sum, r) => sum + r.generationTime, 0);
      const avgTime = totalTime / results.length;

      res.status(201).json({
        success: true,
        message: `Génération parallèle terminée: ${successCount}/${results.length} quiz générés`,
        data: {
          results: results.map(r => ({
            subject: r.subject,
            quizId: r.quizId,
            success: r.success,
            generatedBy: r.generatedBy,
            generationTime: `${r.generationTime}ms`,
            error: r.error
          })),
          stats: {
            successCount,
            totalCount: results.length,
            successRate: `${Math.round((successCount / results.length) * 100)}%`,
            totalTime: `${totalTime}ms`,
            averageTime: `${Math.round(avgTime)}ms`,
            speedImprovement: results.length > 1 ? '~50% plus rapide' : 'N/A'
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur génération parallèle:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération parallèle',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId/results - Récupère les résultats complets de la séquence
   */
  static async getSequenceResults(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: 'ID de séquence requis' });
        return;
      }

      // Récupération des résultats de la séquence
      const results = await QuizService.getSequenceResults(sequenceId, userId);

      res.status(200).json({
        success: true,
        data: { results }
      });

    } catch (error) {
      console.error('Erreur récupération résultats séquence:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des résultats',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/sequence/:sequenceId/quiz/:quizId/submit - Soumet un quiz séquentiel
   */
  static async submitSequentialQuiz(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId, quizId } = req.params;
      const { answers, sourceDocuments, hasDocuments } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId || !quizId) {
        res.status(400).json({ error: 'ID de séquence et quiz requis' });
        return;
      }

      if (!answers || !Array.isArray(answers)) {
        res.status(400).json({ error: 'Réponses requises sous forme de tableau' });
        return;
      }

      // 🛡️ Validation stricte de sourceDocuments pour éviter saturation mémoire
      const validation = validateSourceDocuments(sourceDocuments);
      if (!validation.valid) {
        res.status(400).json({
          error: validation.error,
          ...validation.details
        });
        return;
      }

      // Soumission du quiz séquentiel
      const result = await QuizService.submitSequentialQuiz(sequenceId, quizId, userId, answers, sourceDocuments, hasDocuments);

      // Retourner immédiatement le résultat (correction en arrière-plan si nécessaire)
      res.status(200).json({
        success: true,
        message: result.result.isCorrectingInProgress ? 'Quiz soumis, correction en cours...' : 'Quiz soumis et corrigé avec succès',
        result: result.result
      });

    } catch (error) {
      console.error('Erreur soumission quiz séquentiel:', error);
      res.status(500).json({
        error: 'Erreur lors de la soumission du quiz séquentiel',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/sequence/:sequenceId/quiz/:quizId/correction - Récupère la correction d'un quiz
   */
  static async getQuizCorrection(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId, quizId } = req.params;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId || !quizId) {
        res.status(400).json({ error: 'ID de séquence et quiz requis' });
        return;
      }

      // Récupération du quiz avec ses résultats (correction)
      const quiz = await QuizService.getQuiz(quizId, userId);

      if (!quiz.result) {
        res.status(404).json({ error: 'Correction non disponible pour ce quiz' });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          correction: quiz.result
        }
      });

    } catch (error) {
      console.error('Erreur récupération correction:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération de la correction',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/search-documents - Recherche intelligente dans les documents
   */
  static async searchDocuments(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const {
        query,
        limit = 10,
        similarity_threshold,
        topics
      } = req.body;

      // Validation des paramètres
      if (!query || typeof query !== 'string' || query.trim() === '') {
        res.status(400).json({ 
          error: 'Requête de recherche requise (chaîne non vide)' 
        });
        return;
      }

      if (limit && (typeof limit !== 'number' || limit < 1 || limit > 50)) {
        res.status(400).json({ 
          error: 'Limite doit être un nombre entre 1 et 50' 
        });
        return;
      }

      if (similarity_threshold && (typeof similarity_threshold !== 'number' || similarity_threshold < 0 || similarity_threshold > 1)) {
        res.status(400).json({ 
          error: 'Seuil de similarité doit être un nombre entre 0 et 1' 
        });
        return;
      }

      if (topics && (!Array.isArray(topics) || topics.some(t => typeof t !== 'string'))) {
        res.status(400).json({ 
          error: 'Topics doit être un tableau de chaînes' 
        });
        return;
      }

      // Test de connexion à la base d'embeddings
      const isConnected = await documentSearchService.testConnection();
      if (!isConnected) {
        res.status(503).json({ 
          error: 'Service de recherche documentaire indisponible',
          details: 'Impossible de se connecter à la base de données d\'embeddings'
        });
        return;
      }

      // Exécution de la recherche
      const searchRequest = {
        query: query.trim(),
        limit,
        similarity_threshold,
        topics
      };

      console.log(`🔍 Recherche documentaire pour utilisateur ${userId}:`, {
        query: searchRequest.query,
        limit: searchRequest.limit,
        topics: searchRequest.topics
      });

      const searchResult = await documentSearchService.searchDocuments(searchRequest);

      // Log des résultats pour debug
      console.log(`📊 Résultats recherche: ${searchResult.total_results} chunks en ${searchResult.execution_time_ms}ms`);
      console.log(`🧠 Stratégie: ${searchResult.search_strategy}, Topics détectés:`, searchResult.detected_topics);

      res.status(200).json({
        success: true,
        message: 'Recherche effectuée avec succès',
        data: {
          query: searchRequest.query,
          results: searchResult.chunks,
          metadata: {
            search_strategy: searchResult.search_strategy,
            detected_topics: searchResult.detected_topics,
            total_results: searchResult.total_results,
            execution_time_ms: searchResult.execution_time_ms,
            similarity_threshold: similarity_threshold || 'auto'
          }
        }
      });

    } catch (error) {
      console.error('Erreur recherche documentaire:', error);
      res.status(500).json({
        error: 'Erreur lors de la recherche documentaire',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
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
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      // Test de connexion
      const isConnected = await documentSearchService.testConnection();
      if (!isConnected) {
        res.status(503).json({ 
          error: 'Service documentaire indisponible',
          details: 'Impossible de se connecter à la base de données d\'embeddings'
        });
        return;
      }

      // Récupération des statistiques
      const stats = await documentSearchService.getDocumentStats();

      res.status(200).json({
        success: true,
        data: {
          database_status: 'connected',
          statistics: stats,
          available_topics: stats.topics_available.sort(),
          last_updated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Erreur récupération stats documentaires:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des statistiques',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  // ===== MÉTHODES POUR L'ASSISTANT OPENAI =====

  /**
   * POST /api/quiz/assistant/thread - Crée un thread pour l'Assistant
   */
  static async createAssistantThread(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🤖 Création thread Assistant pour utilisateur:', userId);
      
      const assistantService = new OpenAIAssistantService();
      const threadId = await assistantService.createThread();

      res.status(200).json({
        success: true,
        threadId,
        message: 'Thread Assistant créé avec succès'
      });

    } catch (error) {
      console.error('Erreur création thread Assistant:', error);
      res.status(500).json({
        error: 'Impossible de créer le thread Assistant',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }





  /**
   * POST /api/quiz/assistant/ping - Health check Assistant
   */
  static async pingAssistant(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🤖 Ping Assistant pour utilisateur:', userId);
      
      // Test simple de disponibilité
      const assistantService = new OpenAIAssistantService();
      const isAvailable = await assistantService.ping();

      res.status(200).json({
        success: true,
        status: isAvailable ? 'OK' : 'ERROR',
        timestamp: new Date().toISOString(),
        message: 'Assistant ping réussi'
      });

    } catch (error) {
      console.error('Erreur ping Assistant:', error);
      res.status(500).json({
        error: 'Assistant non disponible',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/test-simple - Test simple utilisant le service @assistant/
   */
  static async testSimpleAssistant(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🧪 Test simple Assistant avec service @assistant/');
      
      // Utilisation du service Assistant proprement
      const assistantService = new OpenAIAssistantService();
      
      console.log('1️⃣ Création thread via service...');
      const threadId = await assistantService.createThread();
      console.log('✅ Thread créé:', threadId);

      console.log('2️⃣ Envoi message via service...');
      const response = await assistantService.sendMessage(threadId, "Dis juste 'bonjour' en français");
      console.log('✅ Réponse reçue:', response);

      // Extraire la réponse de l'Assistant depuis les messages
      let assistantResponse = '';
      if (response && response.messages && response.messages.length > 0) {
        const lastMessage = response.messages[response.messages.length - 1];
        if (lastMessage && lastMessage.content && lastMessage.content[0] && lastMessage.content[0].text) {
          assistantResponse = lastMessage.content[0].text.value;
        }
      }

      res.status(200).json({
        success: true,
        threadId: threadId,
        assistantResponse: assistantResponse,
        fullResponse: response,
        message: '🎉 Test simple réussi avec service @assistant/ !'
      });

    } catch (error) {
      console.error('❌ Erreur test simple Assistant:', error);
      res.status(500).json({
        error: 'Erreur test simple via service @assistant/',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  // ===== MÉTHODES POUR LES 7 FONCTIONS SPÉCIALISÉES DE L'ASSISTANT =====

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

  // 🔧 MÉTHODE DEBUG - Forcer la réinitialisation d'état de séquence
  static async forceResetSequenceState(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sequenceId } = req.params;
      const { action, config, resetCount } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!sequenceId) {
        res.status(400).json({ error: 'ID de séquence requis' });
        return;
      }

      console.log(`🔧 [DEBUG] Force reset pour séquence: ${sequenceId}`);
      console.log(`👤 Utilisateur: ${userId}`);
      console.log(`🎯 Action: ${action}`);
      console.log(`📊 Reset count: ${resetCount}`);

      // Importer le tempSequenceStorage ici pour éviter les imports circulaires
      const { tempSequenceStorage } = await import('../services/quiz/tempSequenceStorage.js');
      
      // 1. Récupérer la config actuelle du stockage
      let currentConfig = tempSequenceStorage.get(sequenceId);
      
      if (!currentConfig) {
        // Fallback: récupérer depuis QuizService si pas en cache
        const currentConfigFromService = await QuizService.getSequenceConfig(sequenceId, userId);
        currentConfig = currentConfigFromService;
        console.log('📋 Config récupérée depuis QuizService (pas en cache tempStorage)');
      }

      if (!currentConfig) {
        res.status(404).json({ error: 'Séquence non trouvée' });
        return;
      }

      console.log(`📊 Config actuelle avant reset:`, {
        currentSubjectIndex: currentConfig.currentSubjectIndex,
        totalSubjects: currentConfig.totalSubjects,
        isCompleted: currentConfig.isCompleted,
        subjectResultsCount: currentConfig.subjectResults?.length || 0
      });

      // 2. Appliquer la config modifiée si fournie
      if (config && config.subjectResults) {
        console.log(`🔄 Application de la config modifiée...`);
        
        // Réinitialiser les états de génération
        let actualResetCount = 0;
        config.subjectResults.forEach((result: any, index: number) => {
          if (result.isGenerating || result.isCorrecting) {
            console.log(`🔧 Reset ${result.subject}: isGenerating=${result.isGenerating} → false, isCorrecting=${result.isCorrecting} → false`);
            result.isGenerating = false;
            result.isCorrecting = false;
            result.error = undefined;
            actualResetCount++;
          }
        });

        // Mettre à jour la config dans tempSequenceStorage
        const updatedConfig = { ...currentConfig, ...config };
        tempSequenceStorage.update(sequenceId, updatedConfig);
        
        console.log(`✅ ${actualResetCount} état(s) réinitialisé(s) dans tempSequenceStorage`);

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
            action: action || 'force_reset',
            timestamp: new Date().toISOString()
          }
        });

      } else {
        res.status(400).json({ error: 'Config modifiée requise' });
      }

    } catch (error) {
      console.error('❌ Erreur force reset séquence:', error);
      res.status(500).json({
        error: 'Erreur lors du reset forcé',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/pages-projects - Récupère les pages et projets disponibles
   */
  static async getPagesProjects(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      // Récupérer tous les workspaces de l'utilisateur avec leurs pages et projets
      const workspaces = await prisma.workspace.findMany({
        where: {
          members: {
            some: {
              userId: userId
            }
          }
        },
        include: {
          pages: {
            where: {
              isArchived: false
            },
            select: {
              id: true,
              title: true,
              updatedAt: true,
              projectId: true,
              icon: true,
              iconColor: true,
              project: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          projects: {
            where: {
              isArchived: false
            },
            include: {
              _count: {
                select: {
                  pages: {
                    where: {
                      isArchived: false
                    }
                  }
                }
              }
            }
          }
        }
      });

      // Formater les données pour le frontend
      const items = [];

      for (const workspace of workspaces) {
        // Ajouter les pages
        for (const page of workspace.pages) {
          // Estimer le nombre de mots basé sur le titre (approximation simple)
          const estimatedWordCount = Math.max(50, page.title.length * 10);
          
          items.push({
            id: page.id,
            title: page.title,
            type: 'page' as const,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceColor: workspace.color,
            lastModified: page.updatedAt.toISOString(),
            estimatedQuestions: Math.max(1, Math.floor(estimatedWordCount / 200)), // ~1 question par 200 mots
            project: page.project,
            icon: page.icon,
            iconColor: page.iconColor
          });
        }

        // Ajouter les projets
        for (const project of workspace.projects) {
          // Estimer les mots basés sur le nombre de pages (approximation)
          const estimatedWordsPerPage = 300;
          const totalWords = project._count.pages * estimatedWordsPerPage;
          
          items.push({
            id: project.id,
            title: project.name,
            type: 'project' as const,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceColor: workspace.color,
            excerpt: project.description || `Projet avec ${project._count.pages} page(s)`,
            lastModified: project.updatedAt.toISOString(),
            wordCount: totalWords,
            estimatedQuestions: Math.max(1, Math.floor(totalWords / 150)), // ~1 question par 150 mots pour les projets
            pageCount: project._count.pages
          });
        }
      }

      // Trier par dernière modification
      items.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

      res.status(200).json({
        success: true,
        items
      });

    } catch (error) {
      console.error('Erreur récupération pages/projets:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des pages et projets',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/context-rag - Construit le contexte RAG pour la génération de quiz
   */
  static async buildQuizRAGContext(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { pageProjectIds, scopeMode } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!pageProjectIds || !Array.isArray(pageProjectIds)) {
        res.status(400).json({ error: 'Liste des IDs de pages/projets requise' });
        return;
      }

      console.log(`🧠 [QUIZ-RAG] Construction contexte pour ${pageProjectIds.length} éléments, mode: ${scopeMode}`);

      // Récupérer les pages sélectionnées
      const pages = await prisma.page.findMany({
        where: {
          id: { in: pageProjectIds },
          workspace: {
            members: {
              some: { userId: userId }
            }
          },
          isArchived: false
        },
        select: {
          id: true,
          title: true,
          workspaceId: true,
          blockNoteContent: true,
          updatedAt: true
        }
      });

      if (pages.length === 0) {
        res.status(404).json({ 
          success: false,
          error: 'Aucune page valide trouvée',
          ragContext: '',
          ragSources: []
        });
        return;
      }

      // Construire la query RAG basée sur les pages sélectionnées
      const pagesQuery = pages.map(p => p.title).join(' + ');
      
      try {
        // Importer le système RAG
        const { ragSystem } = await import('../services/rag/index.js');
        
        // 🔄 Vérifier et reprocesser les pages échouées ou manquantes
        for (const page of pages) {
          const existingSource = await prisma.rAGSource.findFirst({
            where: {
              sourceType: 'WORKSPACE_PAGE',
              userId: userId,
              workspaceId: page.workspaceId,
              metadata: {
                path: ['pageId'],
                equals: page.id
              }
            }
          });

          if (!existingSource || existingSource.status === 'FAILED') {
            console.log(`🔄 [QUIZ-RAG] Reprocessing page ${page.title} (${page.id})`);
            try {
              if (page.blockNoteContent) {
                console.log(`🔍 [QUIZ-RAG] Page "${page.title}" - blockNoteContent type: ${typeof page.blockNoteContent}, length: ${JSON.stringify(page.blockNoteContent).length}`);
                
                // 📦 Extraire le contenu texte depuis blockNoteContent
                let textContent = page.title;
                try {
                  const content = typeof page.blockNoteContent === 'string' 
                    ? JSON.parse(page.blockNoteContent) 
                    : page.blockNoteContent;
                  
                  if (content && Array.isArray(content)) {
                    const textParts = content
                      .filter((block: any) => block?.type === 'paragraph' && block?.content)
                      .map((block: any) => 
                        Array.isArray(block.content) 
                          ? block.content.map((item: any) => item?.text || '').join('')
                          : ''
                      )
                      .filter(Boolean);
                    
                    if (textParts.length > 0) {
                      textContent = page.title + '\n\n' + textParts.join('\n\n');
                    }
                  }
                } catch (error) {
                  console.warn(`🧠 [QUIZ-RAG] Erreur extraction contenu page "${page.title}":`, error);
                }

                console.log(`📦 [QUIZ-RAG] Contenu extrait pour "${page.title}": ${textContent.length} caractères`);
                
                // ⚡ Vérification de contenu minimum (même logique que userPages.ts)
                if (textContent.length < 50) {
                  console.log(`⚠️ [QUIZ-RAG] Contenu trop court pour "${page.title}" (${textContent.length} chars) → Skip embedding`);
                  continue;
                }
                
                const { userPagesRAG } = await import('../services/rag/userPages.js');
                const sourceId = await userPagesRAG.processUserPage({
                  id: page.id,
                  title: page.title,
                  content: textContent,
                  userId: userId,
                  workspaceId: page.workspaceId,
                  updatedAt: page.updatedAt
                });
                
                if (sourceId) {
                  console.log(`✅ [QUIZ-RAG] Page ${page.title} reprocessed successfully → sourceId: ${sourceId}`);
                  
                  // Vérifier que des chunks ont été créés
                  const chunkCount = await prisma.rAGChunk.count({
                    where: { sourceId }
                  });
                  console.log(`📊 [QUIZ-RAG] Chunks créés: ${chunkCount}`);
                } else {
                  console.warn(`⚠️ [QUIZ-RAG] Échec reprocessing pour page "${page.title}"`);
                }
              } else {
                console.warn(`⚠️ [QUIZ-RAG] Page "${page.title}" sans contenu blockNoteContent`);
              }
            } catch (error) {
              console.error(`❌ [QUIZ-RAG] Failed to reprocess page ${page.title}:`, error);
            }
          }
        }
        
        // 🔍 Récupérer les sources RAG correspondant aux pages sélectionnées
        const completedRagSources = await prisma.rAGSource.findMany({
          where: {
            sourceType: 'WORKSPACE_PAGE',
            userId: userId,
            workspaceId: pages[0]?.workspaceId,
            status: 'COMPLETED',
            OR: pageProjectIds.map(pageId => ({
              metadata: {
                path: ['pageId'],
                equals: pageId
              }
            }))
          },
          select: { id: true, title: true }
        });
        
        const specificSourceIds = completedRagSources.map(s => s.id);
        console.log(`🔍 [QUIZ-RAG] Sources RAG trouvées: ${specificSourceIds.length} (${completedRagSources.map(s => s.title).join(', ')})`);
        
        // Recherche RAG intelligente avec sources RAG spécifiques
        const searchResults = await ragSystem.intelligentSearch(pagesQuery, {
          userId: userId,
          workspaceId: pages[0]?.workspaceId,
          limit: scopeMode === 'pages_only' ? 5 : 10,
          includeUserSources: true,
          specificSourceIds: specificSourceIds // 🆕 Passer les IDs des sources RAG
        });

        console.log(`🧠 [QUIZ-RAG] ${searchResults.length} sources RAG trouvées`);
        
        let ragContext = '';
        let ragSourcesForResponse: any[] = [];
        
        if (searchResults.length > 0) {
          // Mode "pages uniquement" : filtrer seulement les pages utilisateur
          const filteredResults = scopeMode === 'pages_only' 
            ? searchResults.filter(r => 
                r.source.type === 'user_page' || 
                r.source.sourceType === 'WORKSPACE_PAGE' ||
                (specificSourceIds.length > 0 && specificSourceIds.includes(r.source.id))
              )
            : searchResults;

          console.log(`🔍 [QUIZ-RAG] Résultats avant filtrage: ${searchResults.length}, après: ${filteredResults.length}`);
          console.log(`🔍 [QUIZ-RAG] Types de sources: ${searchResults.map(r => r.source.type || r.source.sourceType).join(', ')}`);

          if (filteredResults.length > 0) {
            ragContext = await ragSystem.buildOptimizedContext(pagesQuery, filteredResults);
            ragSourcesForResponse = filteredResults.map(r => ({
              title: r.source.title,
              type: r.source.type,
              similarity: r.similarity
            }));
            console.log(`✅ [QUIZ-RAG] Contexte construit: ${ragContext.length} caractères`);
          } else {
            console.log(`⚠️ [QUIZ-RAG] Aucun résultat après filtrage pour mode: ${scopeMode}`);
          }
        }

        res.status(200).json({
          success: true,
          ragContext,
          ragSources: ragSourcesForResponse,
          scopeMode,
          metadata: {
            pagesQueried: pages.length,
            sourcesFound: ragSourcesForResponse.length,
            contextLength: ragContext.length
          }
        });

      } catch (ragError) {
        console.warn('⚠️ [QUIZ-RAG] Erreur récupération contexte RAG:', ragError);
        res.status(200).json({
          success: false,
          error: 'Contexte RAG non disponible',
          ragContext: '',
          ragSources: []
        });
      }

    } catch (error) {
      console.error('Erreur construction contexte RAG quiz:', error);
      res.status(500).json({
        error: 'Erreur lors de la construction du contexte RAG',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/analyze-pages-projects - Analyse les pages/projets sélectionnés
   */
  static async analyzePagesProjects(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { itemIds } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      if (!itemIds || !Array.isArray(itemIds)) {
        res.status(400).json({ error: 'Liste des IDs requise' });
        return;
      }

      const analysisResults = [];

      for (const itemId of itemIds) {
        // Essayer de trouver l'élément comme une page d'abord
        let page = await prisma.page.findFirst({
          where: {
            id: itemId,
            isArchived: false,
            workspace: {
              members: {
                some: {
                  userId: userId
                }
              }
            }
          }
        });

        if (page) {
          // Estimer le nombre de mots basé sur le titre
          const estimatedWordCount = Math.max(50, page.title.length * 10);
          
          analysisResults.push({
            id: page.id,
            title: page.title,
            type: 'page',
            estimatedQuestions: Math.max(1, Math.floor(estimatedWordCount / 200)),
            lastActivity: page.updatedAt.toISOString()
          });
          continue;
        }

        // Sinon, essayer comme un projet
        let project = await prisma.project.findFirst({
          where: {
            id: itemId,
            isArchived: false,
            workspace: {
              members: {
                some: {
                  userId: userId
                }
              }
            }
          },
          include: {
            _count: {
              select: {
                pages: {
                  where: {
                    isArchived: false
                  }
                }
              }
            }
          }
        });

        if (project) {
          // Estimer les mots basés sur le nombre de pages
          const estimatedWordsPerPage = 300;
          const totalWords = project._count.pages * estimatedWordsPerPage;
          
          analysisResults.push({
            id: project.id,
            title: project.name,
            type: 'project',
            pageCount: project._count.pages,
            estimatedQuestions: Math.max(1, Math.floor(totalWords / 150)),
            lastActivity: project.updatedAt.toISOString()
          });
        }
      }

      res.status(200).json({
        success: true,
        items: analysisResults
      });

    } catch (error) {
      console.error('Erreur analyse pages/projets:', error);
      res.status(500).json({
        error: 'Erreur lors de l\'analyse des pages et projets',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/save-fast-correction - Sauvegarde une correction rapide côté frontend
   */
  static async saveFastCorrection(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const { 
        quizId, 
        totalScore, 
        maxScore, 
        percentage, 
        questionResults,
        fastCorrection 
      } = req.body;

      if (!quizId || !Array.isArray(questionResults)) {
        res.status(400).json({ error: 'Données de correction invalides' });
        return;
      }

      console.log(`🚀 [FAST-CORRECTION] Sauvegarde correction rapide pour quiz: ${quizId}`);

      // Vérifier que le quiz appartient à l'utilisateur
      const quiz = await prisma.quiz.findFirst({
        where: {
          id: quizId,
          userId
        }
      });

      if (!quiz) {
        res.status(404).json({ error: 'Quiz non trouvé' });
        return;
      }

      // Préparer le résultat pour la base de données
      const quizResult = {
        quizId,
        totalScore,
        maxScore,
        percentage,
        adaptedGrade: Math.round((totalScore / maxScore) * 20),
        gradeScale: '/20',
        questionResults,
        detailedScoring: questionResults,
        aiCorrection: {
          globalFeedback: `Résultat: ${totalScore}/${maxScore} (${percentage}%) - Correction automatique`,
          recommendations: [],
          strengths: [`Bonnes réponses sur ${questionResults.filter((r: any) => r.isCorrect).length} question(s)`],
          weaknesses: [`Erreurs sur ${questionResults.filter((r: any) => !r.isCorrect).length} question(s)`]
        },
        metadata: {
          correctedAt: new Date().toISOString(),
          aiModel: 'Frontend Fast Correction',
          correctionTime: 0
        }
      };

      // Sauvegarder le résultat en base (même structure que la correction IA)
      const savedResult = await prisma.quizResult.create({
        data: {
          quizId,
          totalScore,
          maxScore,
          percentage,
          adaptedGrade: Math.round((totalScore / maxScore) * 20),
          gradeScale: '/20',
          detailedScoring: questionResults as any,
          aiCorrection: quizResult.aiCorrection as any,
          recommendations: quizResult.aiCorrection.recommendations as any
        }
      });

      console.log(`✅ [FAST-CORRECTION] Résultat sauvegardé: ${savedResult.id}`);

      res.status(200).json({
        success: true,
        data: quizResult
      });

    } catch (error) {
      console.error('❌ [FAST-CORRECTION] Erreur sauvegarde:', error);
      res.status(500).json({
        error: 'Erreur lors de la sauvegarde de la correction rapide',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
} 