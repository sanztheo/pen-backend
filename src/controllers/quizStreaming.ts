import { Request, Response } from 'express';
import { QuizService } from '../services/quiz/quizService.js';
import { SchoolLevel, QuestionType } from '../services/quiz/types.js';
import { OpenAIAssistantService } from '../services/quiz/assistant/index.js';
import { prisma } from '../lib/prisma.js';
import { v4 as uuidv4 } from 'uuid';

// Stockage temporaire des sessions de streaming
const streamingSessions = new Map<string, {
  userId: string;
  request: any;
  createdAt: Date;
}>();

// Nettoyer les sessions expirées (plus de 1 heure)
setInterval(() => {
  const now = new Date();
  for (const [sessionId, session] of streamingSessions.entries()) {
    if (now.getTime() - session.createdAt.getTime() > 60 * 60 * 1000) {
      streamingSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Nettoyer toutes les 5 minutes

/**
 * Contrôleur pour le streaming de génération de quiz
 */
export class QuizStreamingController {

  /**
   * POST /api/quiz/generate-stream - Génère un quiz avec streaming des questions
   */
  static async generateQuizStream(req: Request, res: Response): Promise<void> {
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
        pageProjectIds,
        questionTypes,
        questionCount,
        title,
        description,
        coursesOnly,
        ragContext // 🆕 Récupérer le contexte RAG
      } = req.body;

      // 🧠 Debug: Vérifier la réception du contexte RAG
      console.log(`🧠 [STREAMING-DEBUG] ragContext reçu: ${ragContext ? `${ragContext.length} caractères` : 'VIDE ou undefined'}`);
      console.log(`🧠 [STREAMING-DEBUG] coursesOnly: ${coursesOnly}, pageProjectIds: ${pageProjectIds?.length || 0}`);

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

      console.log(`🚀 [STREAMING] Début génération streaming pour ${questionCount} questions`);

      // 🧠 Vérification des chunks RAG si pages sélectionnées (système d'embedding automatique)
      if (pageProjectIds && pageProjectIds.length > 0 && coursesOnly) {
        console.log(`🔍 [STREAMING-RAG] Vérification chunks pour ${pageProjectIds.length} page(s) sélectionnée(s)`);
        
        try {
          // Compter les chunks disponibles pour les pages sélectionnées
          const chunksCount = await prisma.rAGChunk.count({
            where: {
              source: {
                sourceType: 'WORKSPACE_PAGE',
                userId: userId,
                status: 'COMPLETED',
                OR: pageProjectIds.map((pageId: string) => ({
                  metadata: {
                    path: ['pageId'],
                    equals: pageId
                  }
                }))
              }
            }
          });
          
          console.log(`📊 [STREAMING-RAG] Chunks disponibles: ${chunksCount} pour pages sélectionnées`);
          
          if (chunksCount === 0) {
            console.warn(`⚠️ [STREAMING-RAG] Aucun chunk trouvé pour les pages sélectionnées. Vérification des sources...`);
            
            // Diagnostic des sources RAG
            const ragSources = await prisma.rAGSource.findMany({
              where: {
                sourceType: 'WORKSPACE_PAGE',
                userId: userId,
                OR: pageProjectIds.map((pageId: string) => ({
                  metadata: {
                    path: ['pageId'],
                    equals: pageId
                  }
                }))
              },
              select: {
                id: true,
                title: true,
                status: true,
                totalChunks: true,
                errorMessage: true,
                metadata: true
              }
            });
            
            console.log(`📋 [STREAMING-RAG] Sources RAG trouvées: ${ragSources.length}`);
            ragSources.forEach(source => {
              console.log(`   - "${source.title}": status=${source.status}, chunks=${source.totalChunks}, error="${source.errorMessage}"`);
            });
          }
        } catch (error) {
          console.error(`❌ [STREAMING-RAG] Erreur vérification chunks:`, error);
        }
      }

      // Configuration SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });

      // Fonction pour envoyer des événements SSE
      const sendSSE = (event: string, data: any) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // 1. Créer le quiz en base avec état "generating"
        const quiz = await prisma.quiz.create({
          data: {
            userId,
            title: title || `Quiz ${schoolLevel}`,
            schoolLevel,
            questions: [], // Sera rempli progressivement
            isCompleted: false,
            preset: preset || 'NONE',
            selectedSpecialties: lyceeSpecialties || [],
            higherEdField,
            status: 'generating' // Nouvel état
          }
        });

        // Envoyer l'ID du quiz
        sendSSE('quiz-created', {
          quizId: quiz.id,
          message: 'Quiz créé, génération des questions...'
        });

        // 2. Générer les questions une par une
        const assistantService = new OpenAIAssistantService();
        const generatedQuestions = [];
        
        // Construction de la requête de base
        const baseRequest = {
          userId,
          schoolLevel,
          preset,
          specificSubject,
          sequentialConfig,
          lyceeSpecialties: lyceeSpecialties || [],
          higherEdField,
          targetGrade,
          pageProjectIds: pageProjectIds || [],
          questionTypes,
          title,
          description,
          coursesOnly,
          ragContext // 🆕 Transmettre le contexte RAG à l'assistant
        };

        for (let i = 0; i < questionCount; i++) {
          try {
            console.log(`📝 [STREAMING] Génération question ${i + 1}/${questionCount}`);
            
            // Envoyer le statut de génération
            sendSSE('question-generating', {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              message: `Génération de la question ${i + 1}...`
            });

            // Générer une seule question
            const singleQuestionRequest = {
              ...baseRequest,
              questionCount: 1, // Une seule question
              existingQuestions: generatedQuestions // 🔧 Toujours passer les questions existantes
            };

            console.log(`🧠 [STREAMING-DEBUG] Génération question ${i + 1} avec ${generatedQuestions.length} questions existantes`);

            const questionResult = await assistantService.generateSingleQuestion(singleQuestionRequest);
            
            if (questionResult && questionResult.questions && questionResult.questions.length > 0) {
              const newQuestion = questionResult.questions[0];
              generatedQuestions.push(newQuestion);

              // Sauvegarder la question immédiatement en base
              await prisma.quiz.update({
                where: { id: quiz.id },
                data: {
                  questions: generatedQuestions as any
                }
              });

              // Envoyer la question générée au frontend
              sendSSE('question-generated', {
                questionNumber: i + 1,
                totalQuestions: questionCount,
                question: newQuestion,
                canStartAnswering: i === 0, // Permet de commencer après la première question
                message: `Question ${i + 1} générée avec succès`
              });

              console.log(`✅ [STREAMING] Question ${i + 1} générée et envoyée`);
            } else {
              throw new Error(`Échec génération question ${i + 1}`);
            }

          } catch (questionError) {
            console.error(`❌ [STREAMING] Erreur question ${i + 1}:`, questionError);
            
            sendSSE('question-error', {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              error: `Erreur lors de la génération de la question ${i + 1}`,
              canContinue: generatedQuestions.length > 0
            });

            // Si on a déjà des questions, on peut continuer
            if (generatedQuestions.length === 0) {
              throw questionError;
            }
          }
        }

        // 3. Finaliser le quiz
        const finalQuiz = await prisma.quiz.update({
          where: { id: quiz.id },
          data: {
            status: 'ready',
            questions: generatedQuestions as any
          }
        });

        // Envoyer l'événement de fin
        sendSSE('quiz-completed', {
          quizId: quiz.id,
          totalQuestionsGenerated: generatedQuestions.length,
          totalQuestionsRequested: questionCount,
          message: 'Quiz généré avec succès !',
          quiz: finalQuiz
        });

        console.log(`🎉 [STREAMING] Quiz ${quiz.id} complété avec ${generatedQuestions.length} questions`);

      } catch (error) {
        console.error('❌ [STREAMING] Erreur génération:', error);
        
        sendSSE('error', {
          message: 'Erreur lors de la génération du quiz',
          details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }

      // Fermer la connexion SSE
      sendSSE('end', { message: 'Génération terminée' });
      res.end();

    } catch (error) {
      console.error('❌ [STREAMING] Erreur contrôleur:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Erreur lors de l\'initialisation du streaming',
          details: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }
    }
  }

  /**
   * GET /api/quiz/stream-status/:id - Vérifie le statut d'un quiz en cours de génération
   */
  static async getStreamStatus(req: Request, res: Response): Promise<void> {
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

      res.status(200).json({
        success: true,
        data: {
          id: quiz.id,
          status: quiz.status || 'ready',
          questionsGenerated: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
          isCompleted: quiz.status === 'ready'
        }
      });

    } catch (error) {
      console.error('Erreur vérification statut streaming:', error);
      res.status(500).json({
        error: 'Erreur lors de la vérification du statut',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/streaming-session - Crée une session de streaming
   */
  static async createStreamingSession(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      const sessionId = uuidv4();
      
      // 🧠 Debug: Vérifier les données reçues dans la session
      console.log(`🧠 [SESSION-DEBUG] Données reçues pour session ${sessionId}:`);
      console.log(`  - ragContext: ${req.body.ragContext ? `${req.body.ragContext.length} chars` : 'undefined/null'}`);
      console.log(`  - coursesOnly: ${req.body.coursesOnly}`);
      console.log(`  - pageProjectIds: ${req.body.pageProjectIds?.length || 0}`);
      console.log(`  - Body keys: ${Object.keys(req.body).join(', ')}`);
      
      // Stocker la session temporairement
      streamingSessions.set(sessionId, {
        userId,
        request: req.body,
        createdAt: new Date()
      });

      console.log(`📝 [STREAMING] Session créée: ${sessionId} pour user: ${userId}`);

      res.status(200).json({
        success: true,
        sessionId
      });

    } catch (error) {
      console.error('❌ [STREAMING] Erreur création session:', error);
      res.status(500).json({
        error: 'Erreur lors de la création de la session',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * GET /api/quiz/stream/:sessionId - Stream SSE pour la génération de quiz
   */
  static async streamQuizGeneration(req: Request, res: Response): Promise<void> {
    const sessionId = req.params.sessionId;
    
    // Configuration SSE AVANT toute vérification pour éviter les erreurs JSON
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Fonction pour envoyer des événements SSE
    const sendSSE = (event: string, data: any) => {
      const eventData = `event: ${event}\n`;
      const dataData = `data: ${JSON.stringify(data)}\n\n`;
      console.log(`📤 [STREAMING] Envoi SSE - Event: ${event}`);
      console.log(`📤 [STREAMING] Envoi SSE - Data: ${JSON.stringify(data)}`);
      console.log(`📤 [STREAMING] Format SSE complet:\n${eventData}${dataData}`);
      res.write(eventData);
      res.write(dataData);
      // Forcer l'envoi immédiat des données (pour le streaming en temps réel)
      if (typeof res.flush === 'function') {
        res.flush();
      }
    };

    // Envoyer immédiatement un événement de connexion
    sendSSE('connected', { message: 'Connexion SSE établie' });

    // 🛡️ SÉCURITÉ CRITIQUE: Vérifier l'authentification via JWT
    const token = req.query.token as string;
    if (!token) {
      sendSSE('error', { message: 'Token manquant' });
      res.end();
      return;
    }

    // Vérifier que la session existe AVANT validation JWT
    const session = streamingSessions.get(sessionId);
    if (!session) {
      sendSSE('error', { message: 'Session non trouvée ou expirée' });
      res.end();
      return;
    }

    // 🛡️ VALIDATION JWT OBLIGATOIRE: Vérifier le token et l'ownership de la session
    try {
      const { AuthService } = await import('../services/auth.js');
      const user = await AuthService.verifyToken(token);
      if (!user || user.id !== session.userId) {
        sendSSE('error', { message: 'Authentification requise - Token invalide ou non autorisé' });
        res.end();
        return;
      }
      console.log(`🔗 [STREAMING] ✅ JWT validé pour user ${user.id}, session: ${sessionId}`);
    } catch (error) {
      console.error('❌ [STREAMING] Échec validation JWT:', error);
      sendSSE('error', { message: 'Token invalide ou expiré' });
      res.end();
      return;
    }

    // 🛡️ ANTI-REPLAY: Invalider immédiatement la session pour empêcher les connexions multiples
    streamingSessions.delete(sessionId);
    console.log(`🛡️ [STREAMING] Session ${sessionId} invalidée pour prévenir les attaques replay`);

    try {
      // Récupérer les paramètres de la session
      const {
        schoolLevel,
        questionTypes = ['MULTIPLE_CHOICE'],
        questionCount = 10,
        collegeGrade,
        lyceeSpecialties,
        higherEdField,
        preset,
        title,
        description,
        coursesOnly,
        ragContext, // 🆕 Récupérer le contexte RAG
        pageProjectIds, // 🆕 Récupérer les IDs des pages
        specificSubject,
        sequentialConfig,
        targetGrade,
        timeLimit,
        difficulty
      } = session.request;

      // 🧠 Debug: Vérifier les données récupérées de la session
      console.log(`🧠 [SESSION-RECOVERY-DEBUG] Session ${sessionId} récupérée:`);
      console.log(`  - ragContext: ${ragContext ? `${ragContext.length} chars` : 'undefined/null'}`);
      console.log(`  - coursesOnly: ${coursesOnly}`);
      console.log(`  - pageProjectIds: ${pageProjectIds?.length || 0}`);

      const userId = session.userId;

      console.log(`🚀 [STREAMING] Début génération streaming pour ${questionCount} questions`);

      // 1. Créer le quiz en base avec état "generating"
      const quiz = await prisma.quiz.create({
        data: {
          userId,
          title: title || `Quiz ${schoolLevel}`,
          schoolLevel,
          questions: [], // Sera rempli progressivement
          isCompleted: false,
          status: 'generating',
          preset: preset || 'NONE',
          collegeGrade,
          higherEdField,
          createdAt: new Date(),
          updatedAt: new Date()
          // templateId est optionnel pour les quiz streaming
        }
      });

      // Envoyer l'événement de création de quiz
      sendSSE('quiz-created', {
        quizId: quiz.id,
        message: `Quiz créé avec succès. Génération de ${questionCount} questions...`
      });

      console.log(`✅ [STREAMING] Quiz ${quiz.id} créé, génération des questions...`);

      // 2. Calculer la répartition équitable des types AVANT la génération
      const typeDistribution: string[] = [];
      
      if (questionTypes.length === 1) {
        // Un seul type : toutes les questions de ce type
        for (let i = 0; i < questionCount; i++) {
          typeDistribution.push(questionTypes[0]);
        }
      } else {
        // Plusieurs types : répartition équitable
        const basePerType = Math.floor(questionCount / questionTypes.length);
        const remainder = questionCount % questionTypes.length;
        
        questionTypes.forEach((type: any, typeIndex: number) => {
          const countForThisType = basePerType + (typeIndex < remainder ? 1 : 0);
          for (let i = 0; i < countForThisType; i++) {
            typeDistribution.push(type);
          }
        });
      }
      
      // Mélanger la distribution pour éviter un ordre prévisible
      for (let i = typeDistribution.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [typeDistribution[i], typeDistribution[j]] = [typeDistribution[j], typeDistribution[i]];
      }
      
      console.log(`📊 [STREAMING] Répartition calculée pour ${questionCount} questions:`, 
        questionTypes.map((type: any) => ({
          type, 
          count: typeDistribution.filter(t => t === type).length
        }))
      );

      // 🆕 Générer les questions avec Chat Completion + JSON strict (gpt-4o-mini)
      const generatedQuestions: any[] = [];
      const assistantService = new OpenAIAssistantService();
      
      console.log(`🚀 [STREAMING] Utilisation du mode Chat Completion + JSON strict (gpt-4o-mini) pour ${questionCount} questions`);

      const baseRequest = {
        userId,
        schoolLevel,
        questionCount: 1,
        collegeGrade,
        lyceeSpecialties,
        higherEdField,
        preset,
        specificSubject,
        sequentialConfig,
        targetGrade,
        pageProjectIds: pageProjectIds || [],
        title,
        description,
        coursesOnly,
        ragContext, // 🆕 Transmettre le contexte RAG à l'assistant
        timeLimit,
        difficulty
      };

      for (let i = 0; i < questionCount; i++) {
        try {
          // Récupérer le type spécifique pour cette question
          const specificQuestionType = typeDistribution[i];
          
          // Envoyer l'événement de début de génération
          sendSSE('question-generating', {
            questionNumber: i + 1,
            totalQuestions: questionCount,
            message: `Génération de la question ${i + 1} (${specificQuestionType})...`
          });

          // Générer une seule question avec le type SPÉCIFIQUE
          const singleQuestionRequest = {
            ...baseRequest,
            questionTypes: [specificQuestionType], // ✅ UN SEUL TYPE SPÉCIFIQUE !
            questionCount: 1, // Une seule question
            existingQuestions: generatedQuestions.length > 0 ? generatedQuestions : undefined
          };
          
          console.log(`🎯 [STREAMING] Question ${i + 1}: Type assigné = ${specificQuestionType}`);
          console.log(`🧠 [STREAMING-DEBUG] Envoi au Chat Completion (gpt-4o-mini) pour question ${i + 1}:`);
          console.log(`  - ragContext: ${singleQuestionRequest.ragContext ? `${singleQuestionRequest.ragContext.length} chars` : 'undefined/null'}`);
          console.log(`  - coursesOnly: ${singleQuestionRequest.coursesOnly}`);
          console.log(`  - pageProjectIds: ${singleQuestionRequest.pageProjectIds?.length || 0}`);
          console.log(`  - questionType: ${specificQuestionType}`);
          console.log(`  - model: gpt-4o-mini + JSON strict`);

          // 🚀 Appel optimisé avec Chat Completion + JSON strict
          const questionResult = await assistantService.generateSingleQuestion(singleQuestionRequest);
          
          if (questionResult && questionResult.questions && questionResult.questions.length > 0) {
            const newQuestion = questionResult.questions[0];
            generatedQuestions.push(newQuestion);

            // Sauvegarder la question immédiatement en base
            await prisma.quiz.update({
              where: { id: quiz.id },
              data: {
                questions: generatedQuestions as any
              }
            });

            // Envoyer la question générée au frontend
            sendSSE('question-generated', {
              questionNumber: i + 1,
              totalQuestions: questionCount,
              question: newQuestion,
              canStartAnswering: i === 0, // Permet de commencer après la première question
              message: `Question ${i + 1} générée avec succès (Chat Completion)`
            });

            console.log(`✅ [STREAMING] Question ${i + 1} générée avec Chat Completion + JSON strict et envoyée`);
          } else {
            throw new Error(`Échec génération question ${i + 1}`);
          }

        } catch (questionError) {
          console.error(`❌ [STREAMING] Erreur question ${i + 1}:`, questionError);
          
          sendSSE('question-error', {
            questionNumber: i + 1,
            totalQuestions: questionCount,
            error: questionError instanceof Error ? questionError.message : 'Erreur inconnue',
            message: `Erreur lors de la génération de la question ${i + 1}`
          });
        }
      }

      // 3. Quiz complété - mettre à jour le statut
      const finalQuiz = await prisma.quiz.update({
        where: { id: quiz.id },
        data: {
          status: 'ready',
          questions: generatedQuestions as any
        }
      });

      // Envoyer l'événement de fin
      sendSSE('quiz-completed', {
        quizId: quiz.id,
        totalQuestionsGenerated: generatedQuestions.length,
        totalQuestionsRequested: questionCount,
        message: 'Quiz généré avec succès via Chat Completion !',
        quiz: finalQuiz
      });

      console.log(`🎉 [STREAMING] Quiz ${quiz.id} complété avec ${generatedQuestions.length} questions via Chat Completion + JSON strict (gpt-4o-mini)`);

    } catch (error) {
      console.error('❌ [STREAMING] Erreur génération:', error);
      
      sendSSE('error', {
        message: 'Erreur lors de la génération du quiz',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });

      // Session déjà nettoyée en début de connexion (anti-replay)
    }

    // Fermer la connexion SSE
    sendSSE('end', { message: 'Génération terminée' });
    res.end();
  }
}