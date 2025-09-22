import {
  SchoolLevel,
  CollegeGrade,
  LyceeSpecialty,
  QuestionType,
  Question,
  QuizGenerationRequest,
  QuizCorrectionRequest,
  QuizCorrectionResult,
  GeneratedQuiz,
  UserAnswer,
  WorkspaceAnalysisResult
} from './types.js';

// Import du nouveau système Assistant
import { OpenAIAssistantService } from './assistant/service.js';
// Import du système parallèle pour génération avec 2 assistants
import { ParallelAssistantService } from './assistant/parallelService.js';
import { shouldIncludeDocumentsForSubject } from './utils/documents.js';
// Import des modules refactorisés (fallback)
import { QuizGenerator, CorrectionGenerator, WorkspaceAnalyzer } from './generators/index.js';
import { PromptUtils } from './utils/index.js';
// Import du service de recherche documentaire
import { documentSearchService } from './documentSearchService.js';
import { progressService } from '../progressService.js';

/**
 * Service d'intégration IA spécialisé pour le système de quiz
 * ✅ MIGRÉ vers OpenAI Assistant avec détection automatique
 */
export class AIQuizService {

  /**
   * Génère un quiz complet basé sur les paramètres
   * ✅ MIGRÉ - Utilise maintenant OpenAI Assistant avec détection intelligente
   * 🆕 PARALLÈLE - Option de génération avec 2 assistants pour plus de questions
   * 📊 PROGRESSION - Envoie des mises à jour de progression en temps réel via WebSocket
   */
  static async generateQuiz(request: QuizGenerationRequest, processId?: string): Promise<GeneratedQuiz> {
    console.log('🎯 AIQuizService.generateQuiz() - Migration vers Assistant');
    
    const startTime = Date.now(); // Pour mesurer le temps de génération
    
    // Initialisation de la progression
    if (processId && progressService.hasActiveConnection(processId)) {
      progressService.sendProgress(processId, {
        percentage: 0,
        stage: 'initialization',
        message: 'Initialisation de la génération...'
      });
    }
    
    try {
      // Progression : Analyse de la requête
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 5,
          stage: 'analysis',
          message: 'Analyse de la requête de génération...'
        });
      }

      // 🆕 DÉTECTION GÉNÉRATION PARALLÈLE
      // Active le parallèle si on demande plus de 10 questions ET qu'on a un sujet spécifique
      const shouldUseParallel = (
        request.questionCount >= 15 && // Plus de 15 questions demandées
        (request.title || request.preset) && // Sujet spécifique défini via title ou preset
        request.preset && ['BREVET', 'BAC', 'PARTIELS'].includes(request.preset) // Preset éducatif
      );

      if (shouldUseParallel) {
        // Progression : Génération parallèle détectée
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 10,
            stage: 'parallel_setup',
            message: 'Génération parallèle activée - Configuration des assistants...'
          });
        }
        
        // Déterminer le nom du sujet
        const subjectName = this.getSubjectName(request);
        console.log(`⚡ GÉNÉRATION PARALLÈLE ACTIVÉE: ${request.questionCount} questions pour "${subjectName}"`);
        
        const parallelService = new ParallelAssistantService();
        
        // Préparer le sujet pour la génération parallèle
        // Déterminer si on doit inclure des documents (respecter la config explicite puis la matière)
        const includeDocsExplicit = request.documentConfig?.enableDocuments;
        const includeDocsBySubject = shouldIncludeDocumentsForSubject(subjectName);
        const includeDocs = typeof includeDocsExplicit === 'boolean' ? includeDocsExplicit : includeDocsBySubject;

        // Déterminer si on veut des graphiques
        // Règle simplifiée: on respecte UNIQUEMENT la configuration explicite transmise par le preset
        // (ex: generateBacSubjectRequest envoie graphicConfig.enableGraphics pour les matières scientifiques)
        const includeGraphics = (request as any).graphicConfig?.enableGraphics === true;

        const subjectConfig = {
          id: `parallel_${Date.now()}`,
          title: subjectName,
          preset: request.preset as 'BREVET' | 'BAC' | 'PARTIELS',
          numQuestions: request.questionCount,
          difficulty: this.getDifficultyFromLevel(request.schoolLevel) as 'facile' | 'moyen' | 'difficile',
          questionTypes: request.questionTypes,
          includeDocuments: includeDocs, // Respecter la matière et la config explicite
          includeGraphics, // Activer pour matières scientifiques du Bac ou config explicite
          documentTopics: includeDocs ? this.getDocumentTopicsForSubject(subjectName) : []
        };

        console.log(`🎯 Configuration sujet parallèle:`, subjectConfig);
        
        // Progression : Démarrage génération parallèle
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 15,
            stage: 'parallel_generation',
            message: `Génération de ${request.questionCount} questions avec 2 assistants...`
          });
        }
        
        const parallelResult = await parallelService.generateSingleSubjectParallel(subjectConfig);
        
        if (parallelResult.success && parallelResult.quiz) {
          console.log(`✅ Quiz parallèle généré: ${parallelResult.parallelInfo?.total_questions} questions par ${parallelResult.parallelInfo?.assistant1_questions}+${parallelResult.parallelInfo?.assistant2_questions} assistants`);
          
          // Progression : Génération parallèle terminée
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 90,
              stage: 'parallel_complete',
              message: `Quiz généré avec succès - ${parallelResult.parallelInfo?.total_questions} questions créées`
            });
          }
          
          // Convertir le format pour compatibilité avec GeneratedQuiz
          const convertedQuiz: GeneratedQuiz = {
            id: `parallel_${Date.now()}`,
            title: parallelResult.quiz.title,
            subjects: parallelResult.quiz.subjects || [{ 
              title: subjectName, 
              questions: parallelResult.quiz.questions || [] 
            }],
            questions: parallelResult.quiz.questions || [],
            sourceDocuments: parallelResult.quiz.sourceDocuments || [],
            graphicsData: [], // TODO: Extraire les graphiques si présents
            hasDocuments: parallelResult.quiz.hasDocuments || false,
            hasGraphics: parallelResult.quiz.hasGraphics || false,
            subjectBased: true,
            // Ajouter les métadonnées de génération parallèle
            metadata: {
              generatedAt: new Date(),
              aiModel: 'Parallel OpenAI Assistants',
              generationTime: Date.now() - startTime
            }
          };
          
          // Progression : Finalisation
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendSuccess(processId, convertedQuiz);
          }
          
          return convertedQuiz;
        } else {
          console.warn(`⚠️ Génération parallèle échouée: ${parallelResult.error}, fallback vers assistant unique`);
          // Continue avec la génération standard
        }
      }

      // Progression : Détection des capacités
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 20,
          stage: 'capabilities_detection',
          message: 'Détection des capacités requises...'
        });
      }

      // Détection automatique des capacités nécessaires
      const capabilities = this.detectQuizCapabilities(request);
      console.log('🔍 Capacités détectées:', capabilities);

      const assistantService = new OpenAIAssistantService();

      // Choix de la méthode Assistant appropriée
      console.log('🎯 Sélection du mode de génération basé sur les capacités détectées...');
      
      if (capabilities.needsDocuments && capabilities.needsGraphics) {
        // Progression : Mode complet activé
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: 'complete_mode',
            message: 'Mode complet: génération avec graphiques et documents...'
          });
        }
        
        console.log('🚀 Mode complet: graphiques + documents');
        console.log('📊 Paramètres complets:', { 
          needsDocuments: capabilities.needsDocuments, 
          needsGraphics: capabilities.needsGraphics,
          useFileUpload: capabilities.useFileUpload,
          documentTopics: capabilities.documentTopics 
        });
        return await assistantService.generateWithRetry(
          () => assistantService.generateCompleteQuiz({
            preset: request.preset as any,
            subject: capabilities.subjectName,
            numQuestions: request.questionCount,
            difficulty: this.getDifficultyFromLevel(request.schoolLevel),
            graphicType: capabilities.graphicType,
            library: capabilities.library,
            documentTopics: capabilities.documentTopics,
            questionTypes: request.questionTypes
          }),
          `Complete Quiz: ${capabilities.subjectName}`
        );
      } else if (capabilities.needsDocuments) {
        if (capabilities.useFileUpload) {
          // Progression : Mode documents avec upload
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 25,
              stage: 'document_upload',
              message: 'Recherche et traitement des documents...'
            });
          }
          
          console.log('📚 Mode documents avec File Upload');
          console.log('📊 Paramètres File Upload:', { 
            needsDocuments: capabilities.needsDocuments, 
            useFileUpload: capabilities.useFileUpload,
            documentTopics: capabilities.documentTopics 
          });
          
          // NOUVEAU: Recherche documentaire avant file upload
          const documents = await this.searchDocumentsForSubject(
            capabilities.subjectName, 
            capabilities.documentTopics,
            1, // maxDocuments
            6500 // minDocumentLength
          );
          
          if (documents.length === 0) {
            console.warn('⚠️ Aucun document trouvé, fallback vers mode standard');
            
            // Progression : Fallback mode standard
            if (processId && progressService.hasActiveConnection(processId)) {
              progressService.sendProgress(processId, {
                percentage: 40,
                stage: 'standard_fallback',
                message: 'Génération en mode standard...'
              });
            }
            
            return await assistantService.generateWithRetry(
              () => assistantService.generateStandardQuiz({
                preset: request.preset as any,
                subject: capabilities.subjectName,
                numQuestions: request.questionCount,
                difficulty: this.getDifficultyFromLevel(request.schoolLevel),
                questionTypes: request.questionTypes
              }),
              `Standard Quiz: ${capabilities.subjectName}`
            );
          }
          
          console.log(`📚 Trouvé ${documents.length} documents pour File Upload`);
          
          // Progression : Génération avec documents
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 60,
              stage: 'document_generation',
              message: `Génération avec ${documents.length} document(s)...`
            });
          }
          
          return await assistantService.generateWithRetry(
            () => assistantService.generateQuizWithFullDocuments({
              preset: request.preset as any,
              subject: capabilities.subjectName,
              numQuestions: request.questionCount,
              documents: documents,
              difficulty: this.getDifficultyFromLevel(request.schoolLevel)
            }),
            `Documents Quiz: ${capabilities.subjectName}`
          );
        } else {
          // Progression : Mode documents standard
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 35,
              stage: 'document_standard',
              message: 'Génération avec documents intégrés...'
            });
          }
          
          console.log('📄 Mode documents standard');
          console.log('📊 Paramètres documents:', { 
            needsDocuments: capabilities.needsDocuments, 
            useFileUpload: capabilities.useFileUpload,
            documentTopics: capabilities.documentTopics 
          });
          return await assistantService.generateWithRetry(
            () => assistantService.generateQuizWithDocuments({
              preset: request.preset as any,
              subject: capabilities.subjectName,
              numQuestions: request.questionCount,
              documentTopics: capabilities.documentTopics,
              difficulty: this.getDifficultyFromLevel(request.schoolLevel),
              questionTypes: request.questionTypes
            }),
            `Documents Quiz: ${capabilities.subjectName}`
          );
        }
      } else if (capabilities.needsGraphics) {
        // Progression : Mode graphiques
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 40,
            stage: 'graphics_mode',
            message: 'Génération avec graphiques et visualisations...'
          });
        }
        
        console.log('🎨 Mode graphiques');
        console.log('📊 Paramètres graphiques:', { 
          needsGraphics: capabilities.needsGraphics, 
          graphicType: capabilities.graphicType,
          library: capabilities.library 
        });
                  return await assistantService.generateWithRetry(
            () => assistantService.generateQuizWithGraphics({
              preset: request.preset as any,
              subject: capabilities.subjectName,
              numQuestions: request.questionCount,
              graphicType: capabilities.graphicType,
              library: capabilities.library,
              difficulty: this.getDifficultyFromLevel(request.schoolLevel),
              questionTypes: request.questionTypes
            }),
          `Graphics Quiz: ${capabilities.subjectName}`
        );
      } else {
        // Progression : Mode standard
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: 'standard_mode',
            message: 'Génération en mode standard...'
          });
        }
        
        console.log('⚡ Mode standard');
        console.log('⚠️ ATTENTION: Génération en mode standard - aucun document/graphique détecté');
        console.log('📊 Paramètres standard:', { 
          needsDocuments: capabilities.needsDocuments, 
          needsGraphics: capabilities.needsGraphics,
          useFileUpload: capabilities.useFileUpload,
          documentTopics: capabilities.documentTopics 
        });
        return await assistantService.generateWithRetry(
          () => assistantService.generateStandardQuiz({
            preset: request.preset as any,
            subject: capabilities.subjectName,
            numQuestions: request.questionCount,
            difficulty: this.getDifficultyFromLevel(request.schoolLevel),
            questionTypes: request.questionTypes
          }),
          `Standard Quiz: ${capabilities.subjectName}`
        );
      }
    } catch (error) {
      console.error('❌ Erreur Assistant, fallback vers ancien système:', error);
      
      // Progression : Erreur
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendError(processId, `Erreur de génération: ${error}`);
      }
      
      // Fallback vers l'ancien système en cas d'erreur
      return QuizGenerator.generateQuiz(request);
    }
  }

  // --- UTILITAIRE LOCAL: décisions sur l'usage des documents pour un sujet ---
  private static shouldSubjectIncludeDocuments(subjectName: string): boolean {
    return shouldIncludeDocumentsForSubject(subjectName);
  }

  /**
   * Génère un quiz basé sur le contenu d'un workspace
   * @deprecated Utilisez QuizGenerator.generateQuizFromWorkspace() directement
   */
  static async generateQuizFromWorkspace(
    request: QuizGenerationRequest,
    workspaceContent: WorkspaceAnalysisResult[],
    ragContext?: string
  ): Promise<GeneratedQuiz> {
    return QuizGenerator.generateQuizFromWorkspace(request, workspaceContent, ragContext);
  }

  /**
   * Corrige un quiz avec l'IA
   * ✅ MIGRÉ - Utilise maintenant OpenAI Assistant avec détection intelligente
   * 📊 PROGRESSION - Envoie des mises à jour de progression en temps réel via WebSocket
   */
  static async correctQuiz(
    questions: Question[],
    userAnswers: UserAnswer[],
    request: QuizCorrectionRequest,
    processId?: string
  ): Promise<QuizCorrectionResult> {
    console.log('🎯 AIQuizService.correctQuiz() - Migration vers Assistant');
    
    // Progression : Initialisation correction
    if (processId && progressService.hasActiveConnection(processId)) {
      progressService.sendProgress(processId, {
        percentage: 0,
        stage: 'correction_init',
        message: 'Initialisation de la correction...'
      });
    }
    
    try {
      // Progression : Analyse des réponses
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 10,
          stage: 'response_analysis',
          message: 'Analyse des réponses utilisateur...'
        });
      }
      
      // PRIORITÉ: Si coursesOnly est activé, utiliser le CorrectionGenerator pour une correction stricte
      if (request.coursesOnly && request.workspaceContent && request.workspaceContent.length > 0) {
        console.log('📚 Mode coursesOnly détecté - Utilisation du CorrectionGenerator pour correction stricte');
        
        // Progression : Correction basée sur les cours
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: 'courses_only_correction',
            message: 'Correction basée uniquement sur le contenu de vos cours...'
          });
        }
        
        // Utiliser directement le CorrectionGenerator pour une correction stricte
        return CorrectionGenerator.correctQuiz(questions, userAnswers, request);
      }
      
      // Détection automatique du type de correction nécessaire (pour les autres cas)
      const correctionCapabilities = this.detectCorrectionCapabilities(questions);
      console.log('🔍 Correction - Capacités détectées:', correctionCapabilities);

      const assistantService = new OpenAIAssistantService();
      let assistantResult: any;

      // Progression : Sélection du type de correction
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 20,
          stage: 'correction_type',
          message: 'Sélection du type de correction...'
        });
      }

      // Choix de la méthode de correction Assistant appropriée
      if (correctionCapabilities.hasGraphics && correctionCapabilities.hasDocuments) {
        // Progression : Correction complète
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: 'complete_correction',
            message: 'Correction avancée avec graphiques et documents...'
          });
        }
        
        console.log('🚀 Correction complète: graphiques + documents via Chat Completion');
        assistantResult = await assistantService.correctWithRetry(
          () => assistantService.correctCompleteQuizChatCompletion(
            request.quizId || 'quiz',
            userAnswers,
            {
              graphicsData: correctionCapabilities.graphicsData,
              documentsData: correctionCapabilities.documentsData,
              correctionType: 'complete',
              questions: questions.map(q => ({
                id: q.id,
                question: q.question,
                type: q.type,
                options: 'options' in q ? q.options : undefined
              }))
            }
          ),
          `Complete Correction (Chat Completion): ${request.quizId}`
        );
      } else if (correctionCapabilities.hasDocuments) {
        if (correctionCapabilities.useFileUpload) {
          // Progression : Correction avec documents
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 35,
              stage: 'document_correction',
              message: 'Correction basée sur les documents...'
            });
          }
          
          console.log('🚀 Correction documents avec File Upload via Chat Completion');
          assistantResult = await assistantService.correctWithRetry(
            () => assistantService.correctCompleteQuizChatCompletion(
              request.quizId || 'quiz',
              userAnswers,
              {
                graphicsData: [],
                documentsData: correctionCapabilities.documentsData,
                correctionType: 'documents_files',
                questions: questions.map(q => ({
                  id: q.id,
                  question: q.question,
                  type: q.type,
                  options: 'options' in q ? q.options : undefined
                }))
              }
            ),
            `Documents Correction (Chat Completion): ${request.quizId}`
          );
        } else {
          // Progression : Correction documents standard
          if (processId && progressService.hasActiveConnection(processId)) {
            progressService.sendProgress(processId, {
              percentage: 32,
              stage: 'standard_document_correction',
              message: 'Correction avec documents intégrés...'
            });
          }
          
          console.log('🚀 Correction documents standard via Chat Completion');
          assistantResult = await assistantService.correctWithRetry(
            () => assistantService.correctCompleteQuizChatCompletion(
              request.quizId || 'quiz',
              userAnswers,
              {
                graphicsData: [],
                documentsData: correctionCapabilities.documentsData,
                correctionType: 'documents',
                questions: questions.map(q => ({
                  id: q.id,
                  question: q.question,
                  type: q.type,
                  options: 'options' in q ? q.options : undefined
                }))
              }
            ),
            `Documents Correction (Chat Completion): ${request.quizId}`
          );
        }
      } else if (correctionCapabilities.hasGraphics) {
        // Progression : Correction graphiques
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 35,
            stage: 'graphics_correction',
            message: 'Correction des graphiques et visualisations...'
          });
        }
        
        console.log('🚀 Correction graphiques via Chat Completion');
        assistantResult = await assistantService.correctWithRetry(
          () => assistantService.correctCompleteQuizChatCompletion(
            request.quizId || 'quiz',
            userAnswers,
            {
              graphicsData: correctionCapabilities.graphicsData,
              documentsData: [],
              correctionType: 'graphics',
              questions: questions.map(q => ({
                id: q.id,
                question: q.question,
                type: q.type,
                options: 'options' in q ? q.options : undefined
              }))
            }
          ),
          `Graphics Correction (Chat Completion): ${request.quizId}`
        );
      } else {
        // Progression : Correction standard
        if (processId && progressService.hasActiveConnection(processId)) {
          progressService.sendProgress(processId, {
            percentage: 30,
            stage: 'standard_correction',
            message: 'Correction standard des réponses...'
          });
        }
        
        console.log('🚀 Correction standard via Chat Completion + JSON strict');
        assistantResult = await assistantService.correctWithRetry(
          () => assistantService.correctStandardQuizChatCompletion(
            request.quizId || 'quiz',
            userAnswers,
            {
              questions: questions.map(q => ({
                id: q.id,
                question: q.question,
                options: (q as any).options,
                correctAnswerId: (q as any).correctAnswerId
              }))
            }
          ),
          `Standard Correction (Chat Completion): ${request.quizId}`
        );
      }

      // Progression : Finalisation correction
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendProgress(processId, {
          percentage: 90,
          stage: 'correction_finalization',
          message: 'Finalisation de la correction...'
        });
      }
      
      // Transformation du résultat Assistant vers le format QuizCorrectionResult
      const result = this.transformAssistantResult(assistantResult, questions, userAnswers, request.quizId);
      
      // Progression : Succès
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendSuccess(processId, result);
      }
      
      return result;

    } catch (error) {
      console.error('❌ Erreur correction Assistant, fallback vers ancien système:', error);
      
      // Progression : Erreur
      if (processId && progressService.hasActiveConnection(processId)) {
        progressService.sendError(processId, `Erreur de correction: ${error}`);
      }
      
      // Fallback vers l'ancien système en cas d'erreur
      return CorrectionGenerator.correctQuiz(questions, userAnswers, request);
    }
  }

  /**
   * Analyse le contenu d'un workspace pour la génération de quiz
   * @deprecated Utilisez WorkspaceAnalyzer.analyzeWorkspaceContent() directement
   */
  static async analyzeWorkspaceContent(
    workspaceContent: string,
    workspaceName: string,
    schoolLevel: SchoolLevel
  ): Promise<{
    mainTopics: string[];
    complexity: 'basique' | 'intermédiaire' | 'avancé';
    suggestedQuestionCount: number;
    relevanceScore: number;
  }> {
    return WorkspaceAnalyzer.analyzeWorkspaceContent(workspaceContent, workspaceName, schoolLevel);
  }

  // ========================================
  // MÉTHODES UTILITAIRES CONSERVÉES
  // ========================================

  /**
   * Génère un prompt adapté au niveau scolaire et à la classe spécifique
   * @deprecated Utilisez PromptUtils.getGenerationPromptByLevel() directement
   */
  static getGenerationPromptByLevel(level: SchoolLevel, collegeGrade?: CollegeGrade): string {
    return PromptUtils.getGenerationPromptByLevel(level, collegeGrade);
  }



  /**
   * Templates de prompts par type de question
   * @deprecated Utilisez PromptUtils.getQuestionTypePrompt() directement
   */
  static getQuestionTypePrompt(type: QuestionType): string {
    return PromptUtils.getQuestionTypePrompt(type);
  }

  // ========================================
  // 🆕 NOUVELLES MÉTHODES ASSISTANT
  // ========================================

  /**
   * Détecte automatiquement les capacités nécessaires pour la correction
   */
  private static detectCorrectionCapabilities(questions: Question[]): {
    hasGraphics: boolean;
    hasDocuments: boolean;
    useFileUpload: boolean;
    graphicsData: any[];
    documentsData: any[];
  } {
    let hasGraphics = false;
    let hasDocuments = false;
    const graphicsData: any[] = [];
    const documentsData: any[] = [];

    // Analyser chaque question pour détecter le contexte
    questions.forEach(question => {
      if (question.hasGraphic) {
        hasGraphics = true;
        if (question.graphicId) {
          // ✅ CORRECTION: Inclure TOUTES les données du graphique pour la correction
          graphicsData.push({
            // Format attendu par les méthodes Assistant
            graphicId: question.graphicId,            // ID du graphique (format Assistant)
            config: question.graphicConfig,           // Configuration JSON complète (ApexCharts/Plotly)
            library: question.graphicLibrary,         // Bibliothèque utilisée
            dataValues: question.graphicDataValues || [], // Valeurs clés pour analyse mathématique
            // 🆕 DONNÉES ADDITIONNELLES ENRICHIES:
            type: question.graphicType,               // Type de graphique (2d/3d)
            description: question.graphicDescription, // Description textuelle pour l'IA
            htmlContainer: 'quiz-graphic-container',  // Container HTML par défaut
            questionText: question.question,          // Texte de la question associée
            questionId: question.id                   // ID de la question pour référence
          });
        }
      }

      if (question.basedOnDocument) {
        hasDocuments = true;
        if (question.documentReference) {
          documentsData.push({
            reference: question.documentReference,
            questionId: question.id
          });
        }
      }
    });

    // Déterminer si File Upload est nécessaire pour les documents
    const useFileUpload = hasDocuments && documentsData.length > 0;

    return {
      hasGraphics,
      hasDocuments,
      useFileUpload,
      graphicsData,
      documentsData
    };
  }

  /**
   * Détecte automatiquement les capacités nécessaires pour un quiz
   */
  private static detectQuizCapabilities(request: QuizGenerationRequest): {
    needsGraphics: boolean;
    needsDocuments: boolean;
    useFileUpload: boolean;
    graphicType: '2d' | '3d';
    library: 'apexcharts' | 'plotly';
    documentTopics: string[];
    subjectName: string;
  } {
    console.log('🎯 detectQuizCapabilities - Début détection pour requête:', {
      preset: request.preset,
      specificSubject: request.specificSubject,
      title: request.title,
      documentConfig: request.documentConfig ? 'PRÉSENT' : 'ABSENT'
    });

    // Déterminer le nom du sujet basé sur le preset et autres paramètres
    const subjectName = this.getSubjectName(request);
    const subject = subjectName.toLowerCase();
    console.log('📝 detectQuizCapabilities - Sujet détecté:', subjectName, '(lowercase:', subject + ')');
    
    // PRIORITÉ 1 : Configuration documentaire explicite des séquences (BREVET, BAC, PARTIELS)
    let needsDocuments = false;
    let documentTopics: string[] = [];
    let useFileUpload = false;
    
    if (request.documentConfig && request.documentConfig.enableDocuments) {
      console.log('🔍 Configuration documentaire détectée pour séquence:', request.documentConfig);
      console.log('📚 Documents activés via configuration explicite pour:', subjectName);
      needsDocuments = true;
      documentTopics = request.documentConfig.documentTopics || [];
      useFileUpload = request.documentConfig.maxDocuments > 0; // File Upload si documents configurés
      console.log('✅ Résultat configuration explicite:', { needsDocuments, documentTopics, useFileUpload });
    } else {
      console.log('⚠️ Pas de documentConfig ou enableDocuments=false, passage à la détection automatique');
      console.log('🔍 request.documentConfig:', request.documentConfig || 'undefined');
      
      // PRIORITÉ 2 : Détection automatique par mots-clés (pour quiz non-séquentiels)
      needsDocuments = [
        'histoire', 'géographie', 'philosophie', 'français', 'littérature',
        'ses', 'économie', 'hggsp', 'hlp', 'droit'
      ].some(keyword => subject.includes(keyword));
      
      console.log('🔧 Détection automatique par mots-clés:', { needsDocuments, subject });
    }
    
    // Détection graphiques (matières scientifiques)
    const needsGraphics = [
      'mathématiques', 'maths', 'physique', 'chimie', 'sciences', 'svt',
      'fonction', 'équation', 'courbe', 'graphique', 'statistiques'
    ].some(keyword => subject.includes(keyword));

    // Topics documentaires intelligents (seulement si pas déjà configurés par séquence)
    if (needsDocuments && documentTopics.length === 0) {
      if (subject.includes('histoire') || subject.includes('révolution')) {
        documentTopics = ['revolution', 'moderne', 'guerre_conflits'];
      } else if (subject.includes('philosophie')) {
        documentTopics = ['philosophie', 'philosophie_moderne'];
      } else if (subject.includes('littérature') || subject.includes('français')) {
        documentTopics = ['litterature', 'arts'];
      } else if (subject.includes('économie') || subject.includes('ses')) {
        documentTopics = ['economie', 'moderne'];
      }
    }

    // File Upload si documents nécessaires et topics disponibles
    if (!useFileUpload && needsDocuments && documentTopics.length > 0) {
      useFileUpload = true;
      console.log('📤 File Upload activé car documents nécessaires et topics disponibles');
    }

    const result = {
      needsGraphics,
      needsDocuments,
      useFileUpload,
      graphicType: (subject.includes('3d') || subject.includes('espace') ? '3d' : '2d') as '2d' | '3d',
      library: (subject.includes('plotly') || subject.includes('3d') ? 'plotly' : 'apexcharts') as 'apexcharts' | 'plotly',
      documentTopics,
      subjectName
    };

    console.log('🏁 detectQuizCapabilities - Résultat final:', result);

    return result;
  }

  /**
   * Extrait le nom du sujet à partir de la requête
   */
  private static getSubjectName(request: QuizGenerationRequest): string {
    // PRIORITÉ 1 : Titre complet pour les séquences (ex: "Brevet - Français")
    if (request.title) {
      return request.title;
    }

    // PRIORITÉ 2 : Si c'est un sujet spécifique (séquence)
    if (request.specificSubject) {
      return request.specificSubject;
    }

    // PRIORITÉ 3 : Si c'est une séquence avec preset
    if (request.preset && request.preset !== 'NONE') {
      // Pour les séquences, utiliser le preset comme sujet principal
      return request.preset;
    }

    // Si des spécialités sont définies
    if (request.lyceeSpecialties && request.lyceeSpecialties.length > 0) {
      return request.lyceeSpecialties[0]; // Première spécialité
    }

    // Si champ d'études supérieures
    if (request.higherEdField) {
      return request.higherEdField;
    }

    // Fallback par défaut avec niveau scolaire
    const levelLabel = this.getSchoolLevelLabel(request.schoolLevel);
    return `Quiz ${levelLabel}`;
  }

  /**
   * Convertit le niveau scolaire en libellé français
   */
  private static getSchoolLevelLabel(schoolLevel: SchoolLevel): string {
    switch (schoolLevel) {
      case SchoolLevel.COLLEGE:
        return 'Collège';
      case SchoolLevel.LYCEE_SECONDE:
        return 'Seconde';
      case SchoolLevel.LYCEE_PREMIERE:
        return 'Première';
      case SchoolLevel.LYCEE_TERMINALE:
        return 'Terminale';
      case SchoolLevel.ETUDES_SUPERIEURES:
        return 'Études Supérieures';
      default:
        return 'Général';
    }
  }

  /**
   * Détermine les topics de documents Wikipedia pour un sujet donné
   * SIMPLIFIÉ : Laisse l'IA faire le travail intelligent !
   */
  private static getDocumentTopicsForSubject(subjectName: string): string[] {
    console.log(`🤖 L'IA va générer les topics pour: "${subjectName}"`);
    
    // Plus de détection rigide ! L'IA fait tout dans searchWikipediaWithAI
    // Elle reçoit le sujet brut et génère intelligemment les bons mots-clés
    return [subjectName]; // Juste passer le sujet tel quel à l'IA
  }

  /**
   * Convertit le niveau scolaire en difficulté
   */
  private static getDifficultyFromLevel(schoolLevel: SchoolLevel): 'facile' | 'moyen' | 'difficile' {
    switch (schoolLevel) {
      case SchoolLevel.COLLEGE:
        return 'facile';
      case SchoolLevel.LYCEE_SECONDE:
      case SchoolLevel.LYCEE_PREMIERE:
        return 'moyen';
      case SchoolLevel.LYCEE_TERMINALE:
      case SchoolLevel.ETUDES_SUPERIEURES:
        return 'difficile';
      default:
        return 'moyen';
    }
  }

  /**
   * Transforme le résultat Assistant vers le format QuizCorrectionResult attendu
   */
  private static transformAssistantResult(
    assistantResult: any,
    questions: Question[],
    userAnswers: UserAnswer[],
    quizId?: string
  ): QuizCorrectionResult {
    console.log('🔄 Transformation résultat Assistant:', assistantResult);

    // Transformation des corrections par question vers le format frontend
    const questionResults = (assistantResult.corrections || []).map((correction: any, index: number) => {
      const actualMaxScore = correction.pointsTotal || questions[index]?.points || 1;
      let score = correction.pointsObtained || 0;
      const isCorrect = correction.isCorrect || false;
      
      // 🔧 FIX CRITIQUE: Si l'Assistant indique que la réponse est correcte (isCorrect: true),
      // forcer le score à être égal au maxScore pour éviter les points partiels sur des bonnes réponses
      if (isCorrect && score < actualMaxScore) {
        console.log(`🔧 [ASSISTANT-FIX] Question ${correction.questionId || questions[index]?.id}: Assistant dit correct mais score partiel ${score}/${actualMaxScore} → Correction à ${actualMaxScore}/${actualMaxScore}`);
        score = actualMaxScore;
      }
      
      return {
        questionId: correction.questionId || questions[index]?.id || `q_${index}`,
        isCorrect: isCorrect,
        userAnswer: correction.userAnswer || userAnswers.find(a => a.questionId === (correction.questionId || questions[index]?.id))?.answer || '',
        correctAnswer: correction.correctAnswer || '',
        explanation: correction.explanation || '',
        score: score, // Frontend attend 'score'
        maxScore: actualMaxScore, // Frontend attend 'maxScore'
        feedback: correction.feedback || ''
      };
    });

    // Calculer les scores de base depuis le résultat Assistant
    const totalScore = assistantResult.globalScore?.pointsObtained || questionResults.reduce((sum: number, qr: { score: number }) => sum + qr.score, 0);
    const maxScore = assistantResult.globalScore?.pointsTotal || questionResults.reduce((sum: number, qr: { maxScore: number }) => sum + qr.maxScore, 0);
    const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    // Créer l'objet aiCorrection avec des valeurs par défaut sûres
    const aiCorrection = {
      globalFeedback: this.generateGlobalFeedback(assistantResult, percentage, questionResults),
      recommendations: assistantResult.recommendations || [],
      strengths: this.extractStrengths(assistantResult, questionResults),
      weaknesses: this.extractWeaknesses(assistantResult, questionResults)
    };

    // Calculer la note adaptée au système français
    const adaptedGrade = this.calculateFrenchGrade(percentage);

    return {
      quizId: quizId || 'unknown',
      totalScore,
      maxScore,
      percentage,
      adaptedGrade: adaptedGrade.grade,
      gradeScale: adaptedGrade.scale,
      questionResults: questionResults, // Champ requis
      detailedScoring: questionResults, // Frontend attend 'detailedScoring'
      aiCorrection,
      metadata: {
        correctedAt: new Date(),
        aiModel: 'OpenAI Assistant',
        correctionTime: 0 // Temps de correction non mesuré pour l'instant
      }
    };
  }

  /**
   * Extrait les points forts à partir du résultat Assistant
   */
  private static extractStrengths(assistantResult: any, questionResults: any[]): string[] {
    // Si des forces sont directement fournies
    if (assistantResult.strengths && Array.isArray(assistantResult.strengths)) {
      return assistantResult.strengths;
    }

    // Sinon, les déduire des bonnes réponses
    const strengths: string[] = [];
    const correctAnswers = questionResults.filter(q => q.isCorrect);
    
    if (correctAnswers.length > 0) {
      strengths.push(`Bonnes réponses sur ${correctAnswers.length} question(s)`);
      
      // Analyser les compétences spécifiques selon le type de correction
      if (assistantResult.correctionType === 'with_graphics' && assistantResult.graphicCompetencies) {
        strengths.push('Bonne analyse des graphiques');
      }
      if (assistantResult.correctionType === 'with_documents' && assistantResult.documentaryCompetencies) {
        strengths.push('Bonne compréhension des documents');
      }
    }

    return strengths.length > 0 ? strengths : ['Participation au quiz complétée'];
  }

  /**
   * Extrait les points faibles à partir du résultat Assistant
   */
  private static extractWeaknesses(assistantResult: any, questionResults: any[]): string[] {
    // Si des faiblesses sont directement fournies
    if (assistantResult.weaknesses && Array.isArray(assistantResult.weaknesses)) {
      return assistantResult.weaknesses;
    }

    // Sinon, les déduire des mauvaises réponses
    const weaknesses: string[] = [];
    const incorrectAnswers = questionResults.filter(q => !q.isCorrect);
    
    if (incorrectAnswers.length > 0) {
      weaknesses.push(`Erreurs sur ${incorrectAnswers.length} question(s)`);
      
      // Analyser les difficultés spécifiques
      const conceptErrors = incorrectAnswers.filter(q => 
        q.explanation?.toLowerCase().includes('concept') || 
        q.explanation?.toLowerCase().includes('définition')
      );
      
      if (conceptErrors.length > 0) {
        weaknesses.push('Révision des concepts de base recommandée');
      }
    }

    return weaknesses.length > 0 ? weaknesses : [];
  }

  /**
   * Calcule la note selon le système français
   */
  private static calculateFrenchGrade(percentage: number): { grade: number; scale: string } {
    // Système français standard sur 20
    const grade = Math.round((percentage / 100) * 20 * 100) / 100; // Arrondi à 2 décimales
    return {
      grade: Math.max(0, Math.min(20, grade)), // Borné entre 0 et 20
      scale: '/20'
    };
  }

  /**
   * Génère un feedback global basé sur les résultats
   */
  private static generateGlobalFeedback(
    assistantResult: any, 
    percentage: number, 
    questionResults: any[]
  ): string {
    // Si un feedback global est fourni par l'Assistant, l'utiliser
    if (assistantResult.globalFeedback) {
      return assistantResult.globalFeedback;
    }

    // Sinon, générer un feedback basé sur la performance
    const correctAnswers = questionResults.filter(q => q.isCorrect).length;
    const totalQuestions = questionResults.length;
    
    let feedback = `Résultat: ${correctAnswers}/${totalQuestions} (${percentage}%).\n`;
    
    if (percentage >= 80) {
      feedback += "Excellent travail ! Vous maîtrisez bien le sujet.";
    } else if (percentage >= 60) {
      feedback += "Bon travail ! Quelques points à approfondir.";
    } else if (percentage >= 40) {
      feedback += "Travail correct. Une révision des concepts serait bénéfique.";
    } else {
      feedback += "Des efforts supplémentaires sont nécessaires. Reprenez les bases du sujet.";
    }

    // Ajouter des conseils spécifiques selon le type de correction
    if (assistantResult.correctionType === 'with_graphics') {
      feedback += " Continuez à travailler l'analyse graphique.";
    } else if (assistantResult.correctionType === 'with_documents') {
      feedback += " Approfondissez la compréhension des documents.";
    }

    return feedback;
  }

  /**
   * Recherche des documents Wikipedia pour un sujet donné
   * NOUVEAU: Intègre la recherche documentaire avec troncature à 6500 chars
   */
  private static async searchDocumentsForSubject(
    subjectName: string,
    documentTopics: string[],
    maxDocuments: number,
    minDocumentLength: number
  ): Promise<Array<{
    id: string;
    title: string;
    content: string;
    topic: string;
    similarity?: number;
    source?: string;
  }>> {
    try {
      console.log(`🔍 Recherche documentaire pour "${subjectName}" avec topics:`, documentTopics);
      
      // Construire la requête de recherche
      const searchQuery = `${subjectName} ${documentTopics.join(' ')}`;
      
      const searchRequest = {
        query: searchQuery,
        limit: maxDocuments * 3, // Rechercher plus pour avoir des options
        similarity_threshold: 0.2,
        topics: documentTopics
      };
      
      const searchResult = await documentSearchService.searchDocuments(searchRequest);
      
      if (!searchResult.chunks || searchResult.chunks.length === 0) {
        console.warn('⚠️ Aucun document trouvé pour:', searchQuery);
        return [];
      }
      
      // Filtrer par longueur minimum et prendre les meilleurs
      const filteredChunks = searchResult.chunks
        .filter(chunk => chunk.content.length >= minDocumentLength)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxDocuments);
      
      console.log(`✅ Documents sélectionnés: ${filteredChunks.length} sur ${searchResult.chunks.length} trouvés`);
      
      // Transformer au format attendu avec troncature intelligente
      return filteredChunks.map(chunk => ({
        id: chunk.id?.toString() || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: chunk.title,
        content: this.truncateOnSentenceEnd(chunk.content, 6500), // Troncature intelligente à 6500 chars
        topic: chunk.topic,
        similarity: chunk.similarity,
        source: chunk.source || 'Wikipedia'
      }));
      
    } catch (error) {
      console.error('❌ Erreur recherche documentaire:', error);
      return [];
    }
  }

  /**
   * Tronque un texte à une longueur donnée en finissant sur un point
   */
  private static truncateOnSentenceEnd(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    
    // Chercher le dernier point avant la limite
    const substring = text.substring(0, maxLength);
    const lastDotIndex = substring.lastIndexOf('.');
    
    // Si on trouve un point, couper après le point
    if (lastDotIndex > 0 && lastDotIndex > maxLength * 0.8) { // Au moins 80% de la longueur cible
      return text.substring(0, lastDotIndex + 1);
    }
    
    // Sinon, chercher d'autres signes de ponctuation
    const lastSemicolonIndex = substring.lastIndexOf(';');
    const lastQuestionIndex = substring.lastIndexOf('?');
    const lastExclamationIndex = substring.lastIndexOf('!');
    
    const punctuationIndex = Math.max(lastSemicolonIndex, lastQuestionIndex, lastExclamationIndex);
    
    if (punctuationIndex > maxLength * 0.8) {
      return text.substring(0, punctuationIndex + 1);
    }
    
    // En dernier recours, couper au dernier espace
    const lastSpaceIndex = substring.lastIndexOf(' ');
    if (lastSpaceIndex > maxLength * 0.8) {
      return text.substring(0, lastSpaceIndex) + '...';
    }
    
    // Couper brutalement si aucune solution propre
    return text.substring(0, maxLength) + '...';
  }

} 